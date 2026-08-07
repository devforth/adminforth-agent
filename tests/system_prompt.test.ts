import {
  DEFAULT_AGENT_SYSTEM_PROMPT,
  appendCustomSystemPrompt,
  buildDynamicSystemPrompt,
  buildAgentSystemPrompt,
} from '../domain/systemPrompt.js';

// Characterization tests for system-prompt assembly. The prompt has two halves: the
// static one (base prompt + resource/skill catalog + custom prompt), built once and
// bound to the agent, and the dynamic one, rebuilt from the runtime context before
// every model call. These freeze the composed structure of each and the
// hidden-resource filtering. How the two are joined is covered by
// system_prompt_wiring.test.ts.

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

  describe('buildDynamicSystemPrompt', () => {
    const adminUser = { pk: 'u1', dbUser: { email: 'admin@x.io' } } as any;

    it('includes the admin user context and a definite language instruction', () => {
      const out = buildDynamicSystemPrompt({
        adminUser,
        usernameField: 'email',
        userLanguage: { language: 'Ukrainian', code: 'UK', ambiguous: false },
        chatSurface: undefined,
      });

      expect(out).toContain('admin@x.io');
      expect(out).toContain('Respond in Ukrainian (UK).');
      expect(out).not.toContain('Current chat surface');
    });

    it('carries no part of the static half (that one is bound to the agent)', () => {
      // Anything leaking in here would be re-sent on every model call and would break
      // the static half's byte-for-byte stability that adapters cache on.
      const out = buildDynamicSystemPrompt({ adminUser, usernameField: 'email' });

      expect(out).not.toContain(DEFAULT_AGENT_SYSTEM_PROMPT);
      expect(out).not.toContain('ADMIN_BASE_PATH');
    });

    it('falls back to a generic language instruction when ambiguous, unknown, or absent', () => {
      const ambiguous = buildDynamicSystemPrompt({
        adminUser,
        usernameField: 'email',
        userLanguage: { language: 'x', code: 'x', ambiguous: true },
      });
      const none = buildDynamicSystemPrompt({
        adminUser,
        usernameField: 'email',
        userLanguage: null,
      });
      // Undefined is the HITL-resume case, where no detection ran for this call.
      const missing = buildDynamicSystemPrompt({ adminUser, usernameField: 'email' });

      expect(ambiguous).toContain("Respond in the user's language.");
      expect(none).toContain("Respond in the user's language.");
      expect(missing).toContain("Respond in the user's language.");
    });

    it('adds a chat-surface note when a surface is present', () => {
      const out = buildDynamicSystemPrompt({
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
