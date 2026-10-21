import AdminForthAgentPlugin from '../index.js';

// The agent's own resources hold chat history and checkpoints: the MCP server must not
// offer them to agents, while the admin panel still shows them to users allowed to see them.

function resource(resourceId: string) {
  return { resourceId, options: {} } as any;
}

test('hides its session, turn and checkpoint resources from agents', async () => {
  const plugin = new AdminForthAgentPlugin({
    modes: [{ name: 'Default', completionAdapter: {} }],
    sessionResource: { resourceId: 'sessions' },
    turnResource: { resourceId: 'turns' },
    checkpointResource: { resourceId: 'agent_checkpoints' },
  } as any);
  const resources = ['sessions', 'turns', 'agent_checkpoints', 'cars'].map(resource);

  await plugin.modifyGlobalConfig({
    config: { customization: { globalInjections: {} }, resources },
    codeInjector: { srcFoldersToSync: {}, allComponentNames: {} },
  } as any);

  expect(resources.map(({ options }) => options.agent?.hiddenFromAgents ?? false)).toEqual([true, true, true, false]);
});
