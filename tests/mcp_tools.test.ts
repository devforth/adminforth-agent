import { McpServer } from '@modelcontextprotocol/server';
import { InMemoryTransport } from '@modelcontextprotocol/client';
import { AgentToolProvider } from '../tools/agentToolProvider.js';
import { connectMcp } from '../tools/mcpConnection.js';

// The agent reaches every admin panel tool through the @adminforth/mcp plugin. These tests
// stand a real MCP server up behind a fake plugin, connected in memory exactly like the
// plugin's `openConnection`, and freeze what the agent takes from it.

const MCP_TOOLS = [
  { name: 'fetch_skill', description: 'Loads a skill.', inputSchema: { type: 'object', properties: { skillName: { type: 'string' } } } },
  { name: 'get_resource', description: 'Gets a resource.', inputSchema: { type: 'object', properties: { resourceId: { type: 'string' } } } },
  {
    name: 'get_resource_data',
    description: 'Gets records.\nReturns 10 rows unless limit is passed.',
    inputSchema: { type: 'object', properties: { resourceId: { type: 'string' } } },
  },
  {
    name: 'delete_record',
    description: 'Deletes a record.',
    inputSchema: { type: 'object', properties: { resourceId: { type: 'string' } } },
    annotations: { destructiveHint: true },
  },
];

type ToolCall = { name: string; arguments: unknown; signal: AbortSignal };

function fakeMcpPlugin(callTool: (call: ToolCall) => Promise<string> = async ({ name }) => `called: ${name}`) {
  const sessions: any[] = [];
  const calls: ToolCall[] = [];

  return {
    sessions,
    calls,
    async openConnection(session: unknown) {
      sessions.push(session);
      const server = new McpServer(
        { name: 'test-mcp', version: '1.0.0' },
        { capabilities: { tools: { listChanged: false } }, instructions: 'MCP_RULES' },
      );
      server.server.setRequestHandler('tools/list', () => ({ tools: MCP_TOOLS as any }));
      server.server.setRequestHandler('tools/call', async ({ params }, ctx) => {
        const call = { name: params.name, arguments: params.arguments, signal: ctx.mcpReq.signal };
        calls.push(call);
        return { content: [{ type: 'text', text: await callTool(call) }], isError: false };
      });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      return clientTransport;
    },
  };
}

function createProvider(mcp: ReturnType<typeof fakeMcpPlugin>) {
  return new AgentToolProvider(() => ({
    config: { baseUrlSlashed: '/admin/' },
    getPluginByClassName: (className: string) => {
      expect(className).toBe('AdminForthMcpPlugin');
      return mcp;
    },
  }) as any);
}

const adminUser = { pk: 'u1', dbUser: { email: 'admin@x.io' } } as any;

describe('MCP tools of the agent', () => {
  it('connects as the turn user with the agent identity and full user permissions', async () => {
    const mcp = fakeMcpPlugin();
    const toolSet = await createProvider(mcp).open({ adminUser, sessionId: 's1', userTimeZone: 'Europe/Kyiv' });

    expect(mcp.sessions).toEqual([{
      adminUser: { ...adminUser, executedBy: 'af-agent' },
      connection: { id: 'agent:s1', name: 'AdminForth Agent' },
      readOnly: false,
      headers: {},
      requestUrl: '/admin/',
      timeZone: 'Europe/Kyiv',
    }]);
    expect(toolSet.instructions).toBe('MCP_RULES');
    await toolSet.close();
  });

  it('exposes base MCP tools at once and the others on demand, with approval for destructive ones', async () => {
    const toolSet = await createProvider(fakeMcpPlugin()).open({ adminUser, sessionId: 's1' });

    expect(toolSet.baseTools.map((tool) => tool.name)).toEqual([
      'fetch_skill',
      'get_resource',
      'get_user_location',
      'navigate_user',
      'fetch_tool_schema',
    ]);
    expect(Object.keys(toolSet.dynamicTools)).toEqual(['get_resource_data', 'delete_record']);
    expect(toolSet.approvalToolNames).toEqual(['delete_record']);
    await toolSet.close();
  });

  it('loads tool schemas only for tools the MCP server has', async () => {
    const toolSet = await createProvider(fakeMcpPlugin()).open({ adminUser, sessionId: 's1' });
    const fetchToolSchema = toolSet.baseTools.find((tool) => tool.name === 'fetch_tool_schema')!;

    expect(JSON.parse(await fetchToolSchema.invoke({ toolName: 'delete_record' }) as string))
      .toEqual({ status: 200, name: 'delete_record', loaded: true });
    expect(JSON.parse(await fetchToolSchema.invoke({ toolName: 'drop_database' }) as string))
      .toMatchObject({ status: 404, error: 'TOOL_NOT_FOUND' });
    await toolSet.close();
  });

  it('names every tool it can load in the fetch_tool_schema description, like on-demand MCP clients', async () => {
    const toolSet = await createProvider(fakeMcpPlugin()).open({ adminUser, sessionId: 's1' });
    const { description } = toolSet.baseTools.find((tool) => tool.name === 'fetch_tool_schema')!;

    expect(description).toContain('Tools you can load:\n- get_resource_data: Gets records.\n- delete_record: Deletes a record.');
    expect(description).not.toContain('Returns 10 rows');
    expect(description).not.toContain('- get_resource:');
    await toolSet.close();
  });

  it('calls an MCP tool and returns its text output', async () => {
    const mcp = fakeMcpPlugin();
    const connection = await connectMcp(mcp, { adminUser, sessionId: 's1', requestUrl: '/admin/' });

    expect(await connection.callTool('get_resource', { resourceId: 'cars' })).toBe('called: get_resource');
    expect(mcp.calls.map(({ name, arguments: args }) => ({ name, args })))
      .toEqual([{ name: 'get_resource', args: { resourceId: 'cars' } }]);
    await connection.close();
  });

  it('aborts the MCP tool call when the turn is aborted', async () => {
    const mcp = fakeMcpPlugin(({ signal }) => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve('aborted'));
    }));
    const connection = await connectMcp(mcp, { adminUser, sessionId: 's1', requestUrl: '/admin/' });
    const controller = new AbortController();

    const call = connection.callTool('get_resource', { resourceId: 'cars' }, controller.signal);
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();

    await expect(call).rejects.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(mcp.calls[0].signal.aborted).toBe(true);
    await connection.close();
  });
});
