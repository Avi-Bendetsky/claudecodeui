import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// P1-07: Verify 9Router env wiring in Codex spawner
test('P1-07: openai-codex.js forwards OPENAI_API_BASE to Codex spawn env', () => {
  const codexPath = path.resolve(__dirname, '../../../openai-codex.js');
  const source = fs.readFileSync(codexPath, 'utf8');
  assert.ok(
    source.includes('OPENAI_API_BASE') || source.includes('baseUrl') || source.includes('base_url'),
    'openai-codex.js should reference OPENAI_API_BASE or baseUrl for 9Router proxy',
  );
});

// P1-07: claude-sdk.js forwards env to subprocess
test('P1-07: claude-sdk.js passes process.env to SDK subprocess', () => {
  const sdkPath = path.resolve(__dirname, '../../../claude-sdk.js');
  const source = fs.readFileSync(sdkPath, 'utf8');
  assert.ok(
    source.includes('process.env') && source.includes('sdkOptions.env'),
    'claude-sdk.js should pass process.env to subprocess so OPENAI_API_BASE is forwarded',
  );
});

// P1-08: Claude OAuth is NOT proxied through 9Router
test('P1-08: claude-sdk.js does not override ANTHROPIC_BASE_URL directly', () => {
  const sdkPath = path.resolve(__dirname, '../../../claude-sdk.js');
  const source = fs.readFileSync(sdkPath, 'utf8');
  const setsAnthropicBase = /ANTHROPIC_BASE_URL\s*=/.test(source);
  assert.ok(
    !setsAnthropicBase,
    'claude-sdk.js should NOT set ANTHROPIC_BASE_URL — Claude uses its own OAuth, not 9Router',
  );
});

// P1-07: openclaude-cli.js DOES set ANTHROPIC_BASE_URL from OPENAI_API_BASE
test('P1-07: openclaude-cli.js sets ANTHROPIC_BASE_URL from OPENAI_API_BASE for 9Router', () => {
  const occPath = path.resolve(__dirname, '../../../openclaude-cli.js');
  const source = fs.readFileSync(occPath, 'utf8');
  assert.ok(
    source.includes('ANTHROPIC_BASE_URL') && source.includes('OPENAI_API_BASE'),
    'openclaude-cli.js should proxy LLM calls through 9Router via ANTHROPIC_BASE_URL',
  );
});
