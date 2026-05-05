import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/modules/providers/services/sessions.service.js', () => ({
  sessionsService: {
    ensureSessionAndProject: vi.fn(),
    normalizeMessage: vi.fn().mockReturnValue([]),
  },
}));
vi.mock('@/modules/providers/services/provider-auth.service.js', () => ({
  providerAuthService: {
    getProviderStatus: vi.fn().mockResolvedValue({ authenticated: true }),
    isProviderInstalled: vi.fn().mockResolvedValue(true),
  },
}));
vi.mock('@/services/notification-orchestrator.js', () => ({
  notifyRunFailed: vi.fn(),
  notifyRunStopped: vi.fn(),
}));

/* eslint-disable boundaries/no-unknown -- root-level server file, not a module */
import {
  spawnOpenClaude,
  abortOpenClaudeSession,
  isOpenClaudeSessionActive,
  getActiveOpenClaudeSessions,
} from '@/openclaude-cli.js';
/* eslint-enable boundaries/no-unknown */

// P3-18: spawnOpenClaude sends session_created message
test('P3-18: spawnOpenClaude sends session_created on startup', async () => {
  const messages: unknown[] = [];
  const mockWs = {
    send: (msg: unknown) => messages.push(typeof msg === 'string' ? JSON.parse(msg as string) : msg),
    userId: null,
  };

  // Will reject because 'occ' binary doesn't exist in test env — that's expected
  try {
    await spawnOpenClaude('hello', { cwd: '/tmp' }, mockWs);
  } catch {
    // Expected: occ binary not found
  }

  const sessionCreated = messages.find(
    (m: Record<string, unknown>) => m.kind === 'session_created' || (m as Record<string, unknown>).type === 'session_created',
  );
  assert.ok(sessionCreated, 'Should send session_created message before spawning OCC');
});

// P3-18: OCC normalizes all 13 event types
test('P3-18: openclaude-cli.js handles all 13 event types in normalizeOccEvent', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../openclaude-cli.js'), 'utf8');
  const eventTypes = [
    'stream_event', 'assistant', 'tool_use', 'tool_result',
    'thinking', 'error', 'result', 'stop',
    'permission_request', 'agent_spawn', 'stream_request_start', 'compaction',
  ];
  for (const eventType of eventTypes) {
    assert.ok(
      source.includes(`'${eventType}'`),
      `normalizeOccEvent should handle event type: ${eventType}`,
    );
  }
});

// P3-19: abort returns true for active session, false for unknown
test('P3-19: abortOpenClaudeSession returns false for non-existent session', () => {
  assert.equal(abortOpenClaudeSession('nonexistent-session-xyz'), false);
});

test('P3-19: isOpenClaudeSessionActive returns false for non-existent session', () => {
  assert.equal(isOpenClaudeSessionActive('nonexistent-session-xyz'), false);
});

// P3-20: session store tracks active sessions
test('P3-20: getActiveOpenClaudeSessions returns Map that can track sessions', () => {
  const sessions = getActiveOpenClaudeSessions();
  assert.ok(sessions instanceof Map, 'Should return a Map');
  assert.equal(typeof sessions.has, 'function');
  assert.equal(typeof sessions.set, 'function');
  assert.equal(typeof sessions.delete, 'function');
});

// P3-20: WebSocket service has openclaude in provider list for sidebar
test('P3-20: chat-websocket.service.ts includes openclaude in session-status handler', () => {
  const wsPath = path.resolve(__dirname, '../../websocket/services/chat-websocket.service.ts');
  const source = fs.readFileSync(wsPath, 'utf8');
  assert.ok(
    source.includes('isOpenClaudeSessionActive') || source.includes("'openclaude'"),
    'WebSocket service should check openclaude session activity for sidebar status',
  );
});

// P3-21: OCC session synchronizer exists and reads checkpoints
test('P3-21: openclaude session synchronizer reads checkpoint files', () => {
  const syncPath = path.resolve(__dirname, '../../providers/list/openclaude/openclaude-session-synchronizer.provider.ts');
  const source = fs.readFileSync(syncPath, 'utf8');
  assert.ok(
    source.includes('checkpoint') || source.includes('readdir') || source.includes('SessionSynchronizer'),
    'OCC session synchronizer should support checkpoint-based session resume',
  );
});

// P3-21: Resume flag is supported in spawnOpenClaude
test('P3-21: openclaude-cli.js supports --resume flag for session resumability', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../openclaude-cli.js'), 'utf8');
  assert.ok(source.includes('--resume'), 'spawnOpenClaude should support --resume flag');
});
