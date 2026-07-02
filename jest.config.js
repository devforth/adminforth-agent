// Self-contained test config for the @adminforth/agent plugin.
// Runs the plugin's own tests in isolation: `pnpm test` (see package.json).
// Third-party ESM deps (adminforth, langchain, @langchain/*) load natively from the
// plugin's node_modules and are not transformed; only the plugin's own `.ts` is transpiled.
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  rootDir: '.',
  roots: ['<rootDir>/tests'],
  resolver: './tests/resolver.cjs',
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, diagnostics: false, tsconfig: './tests/tsconfig.json' }],
  },
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
};
