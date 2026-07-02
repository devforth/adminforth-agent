import {
  DEFAULT_AGENT_SYSTEM_PROMPT,
  appendCustomSystemPrompt,
  buildAgentTurnSystemPrompt,
  buildAgentSystemPrompt,
} from '../domain/systemPrompt.js';

// Characterization tests for system-prompt assembly (base prompt, per-turn additions,
// and the resource/skill catalog prompt). Freezes the composed structure and the
// hidden-resource filtering.

describe('adminforth-agent system prompt', () => {
  describe('appendCustomSystemPrompt', () => {
    it('returns the base prompt unchanged when no custom prompt is given', () => {
      expect(appendCustomSystemPrompt('BASE')).toBe('BASE');
    });

    it('ignores a whitespace-only custom prompt', () => {
      expect(appendCustomSystemPrompt('BASE', '   ')).toBe('BASE');
    });

    it('appends a trimmed custom prompt after two newlines', () => {
      expect(appendCustomSystemPrompt('BASE', '  EXTRA  ')).toBe('BASE\n\nEXTRA');
    });
  });

  describe('buildAgentTurnSystemPrompt', () => {
    const adminUser = { pk: 'u1', dbUser: { email: 'admin@x.io' } } as any;

    it('includes the base prompt, admin user context, and a definite language instruction', () => {
      const out = buildAgentTurnSystemPrompt({
        agentSystemPrompt: 'SYS',
        adminUser,
        usernameField: 'email',
        userLanguage: { language: 'Ukrainian', code: 'UK', ambiguous: false },
        chatSurface: undefined,
      });

      expect(out).toContain('SYS');
      expect(out).toContain('admin@x.io');
      expect(out).toContain('Respond in Ukrainian (UK).');
      expect(out).not.toContain('Current chat surface');
    });

    it('falls back to a generic language instruction when ambiguous or unknown', () => {
      const ambiguous = buildAgentTurnSystemPrompt({
        agentSystemPrompt: 'SYS',
        adminUser,
        usernameField: 'email',
        userLanguage: { language: 'x', code: 'x', ambiguous: true },
      });
      const none = buildAgentTurnSystemPrompt({
        agentSystemPrompt: 'SYS',
        adminUser,
        usernameField: 'email',
        userLanguage: null,
      });

      expect(ambiguous).toContain("Respond in the user's language.");
      expect(none).toContain("Respond in the user's language.");
    });

    it('adds a chat-surface note when a surface is present', () => {
      const out = buildAgentTurnSystemPrompt({
        agentSystemPrompt: 'SYS',
        adminUser,
        usernameField: 'email',
        userLanguage: null,
        chatSurface: 'telegram',
      });

      expect(out).toContain('Current chat surface: telegram');
    });
  });

  describe('buildAgentSystemPrompt', () => {
    function fakeAdminforth() {
      return {
        config: {
          customization: { customComponentsDir: '/tmp/adminforth-agent-nonexistent-skills-dir' },
          baseUrlSlashed: '/admin/',
          resources: [
            { resourceId: 'cars', label: 'Cars' },
            { resourceId: 'sessions', label: 'Sessions' },
          ],
        },
        activatedPlugins: [],
      } as any;
    }

    it('lists visible resources, hides internal resources, and includes the base prompt + base path', async () => {
      const out = await buildAgentSystemPrompt(fakeAdminforth(), ['sessions']);

      expect(out).toContain(DEFAULT_AGENT_SYSTEM_PROMPT);
      expect(out).toContain('ADMIN_BASE_PATH: /admin/');
      expect(out).toContain('resourceId: cars');
      expect(out).not.toContain('resourceId: sessions');
      // Fixed skill-discovery guidance is always present.
      expect(out).toContain('Before using any skill, call fetch_skill');
      expect(out).toContain('If the user wants to fetch records, load fetch_data first');
    });
  });
});
