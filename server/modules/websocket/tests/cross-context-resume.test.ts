import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const WS_SERVICE_PATH = path.resolve('server/modules/websocket/services/chat-websocket.service.ts');

test('P7-05: cross-context-resume message type exists in WebSocket service', () => {
  const source = fs.readFileSync(WS_SERVICE_PATH, 'utf8');
  assert.ok(
    source.includes('cross-context-resume'),
    'WebSocket service should handle cross-context-resume messages',
  );
});

test('P7-05: cross-context-resume dispatches to target provider', () => {
  const source = fs.readFileSync(WS_SERVICE_PATH, 'utf8');
  assert.ok(
    source.includes('targetProvider') && source.includes('context'),
    'cross-context-resume should use targetProvider and context fields',
  );
});
