import { describe, it, expect } from 'vitest';

describe('provider CLI modules export required functions', () => {
  const providers = [
    { name: 'claude', module: '../../../claude-sdk.js', fns: ['queryClaudeSDK', 'abortClaudeSDKSession', 'isClaudeSDKSessionActive', 'getActiveClaudeSDKSessions'] },
    { name: 'cursor', module: '../../../cursor-cli.js', fns: ['spawnCursor', 'abortCursorSession', 'isCursorSessionActive', 'getActiveCursorSessions'] },
    { name: 'codex', module: '../../../openai-codex.js', fns: ['queryCodex', 'abortCodexSession', 'isCodexSessionActive', 'getActiveCodexSessions'] },
    { name: 'gemini', module: '../../../gemini-cli.js', fns: ['spawnGemini', 'abortGeminiSession', 'isGeminiSessionActive', 'getActiveGeminiSessions'] },
    { name: 'openclaude', module: '../../../openclaude-cli.js', fns: ['spawnOpenClaude', 'abortOpenClaudeSession', 'isOpenClaudeSessionActive', 'getActiveOpenClaudeSessions'] },
    { name: 'crewai', module: '../../../crewai-bridge-client.js', fns: ['queryCrewAI', 'abortCrewAISession', 'isCrewAISessionActive', 'getActiveCrewAISessions'] },
  ];

  for (const { name, module: mod, fns } of providers) {
    describe(name, () => {
      it(`exports all required functions`, async () => {
        const exports = await import(mod);
        for (const fn of fns) {
          expect(typeof exports[fn]).toBe('function');
        }
      });
    });
  }
});

describe('provider registry', () => {
  it('lists all 7 providers', async () => {
    const { providerRegistry } = await import('@/modules/providers/provider.registry.js');
    const providers = providerRegistry.listProviders();
    expect(providers).toHaveLength(7);
  });

  it('resolves each provider by name', async () => {
    const { providerRegistry } = await import('@/modules/providers/provider.registry.js');
    const names = ['claude', 'codex', 'cursor', 'gemini', 'groq', 'openclaude', 'crewai'];
    for (const name of names) {
      const provider = providerRegistry.resolveProvider(name);
      expect(provider).toBeDefined();
      expect(provider.id).toBe(name);
    }
  });

  it('throws for unknown provider', async () => {
    const { providerRegistry } = await import('@/modules/providers/provider.registry.js');
    expect(() => providerRegistry.resolveProvider('nonexistent')).toThrow();
  });
});

