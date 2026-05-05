import assert from 'node:assert/strict';

import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';

test('handleChatConnection accepts openclaude dependencies', () => {
  assert.equal(typeof handleChatConnection, 'function');
});

test('chat-websocket.service.ts source includes openclaude-command handler', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const filePath = path.resolve('server/modules/websocket/services/chat-websocket.service.ts');
  const source = await fs.readFile(filePath, 'utf8');
  assert.ok(source.includes("'openclaude-command'"), 'Should handle openclaude-command message type');
});

test('chat-websocket.service.ts source includes crewai-command handler', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const filePath = path.resolve('server/modules/websocket/services/chat-websocket.service.ts');
  const source = await fs.readFile(filePath, 'utf8');
  assert.ok(source.includes("'crewai-command'"), 'Should handle crewai-command message type');
});

test('readProvider recognizes openclaude', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const filePath = path.resolve('server/modules/websocket/services/chat-websocket.service.ts');
  const source = await fs.readFile(filePath, 'utf8');
  assert.ok(source.includes("'openclaude'"), 'readProvider should accept openclaude');
});

test('readProvider recognizes crewai', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const filePath = path.resolve('server/modules/websocket/services/chat-websocket.service.ts');
  const source = await fs.readFile(filePath, 'utf8');
  assert.ok(source.includes("'crewai'"), 'readProvider should accept crewai');
});

test('abort-session handles openclaude provider', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const filePath = path.resolve('server/modules/websocket/services/chat-websocket.service.ts');
  const source = await fs.readFile(filePath, 'utf8');
  assert.ok(source.includes('abortOpenClaudeSession'), 'Should call abortOpenClaudeSession');
});

test('abort-session handles crewai provider', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const filePath = path.resolve('server/modules/websocket/services/chat-websocket.service.ts');
  const source = await fs.readFile(filePath, 'utf8');
  assert.ok(source.includes('abortCrewAISession'), 'Should call abortCrewAISession');
});

test('check-session-status handles openclaude provider', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const filePath = path.resolve('server/modules/websocket/services/chat-websocket.service.ts');
  const source = await fs.readFile(filePath, 'utf8');
  const checkBlock = source.slice(source.indexOf('check-session-status'), source.indexOf('get-pending-permissions'));
  assert.ok(
    checkBlock.includes('isOpenClaudeSessionActive'),
    'check-session-status handler should call isOpenClaudeSessionActive for openclaude provider',
  );
});

test('check-session-status handles crewai provider', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const filePath = path.resolve('server/modules/websocket/services/chat-websocket.service.ts');
  const source = await fs.readFile(filePath, 'utf8');
  const checkBlock = source.slice(source.indexOf('check-session-status'), source.indexOf('get-pending-permissions'));
  assert.ok(
    checkBlock.includes('isCrewAISessionActive'),
    'check-session-status handler should call isCrewAISessionActive for crewai provider',
  );
});

test('get-active-sessions includes openclaude', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const filePath = path.resolve('server/modules/websocket/services/chat-websocket.service.ts');
  const source = await fs.readFile(filePath, 'utf8');
  assert.ok(
    source.includes('getActiveOpenClaudeSessions') && source.includes('active-sessions'),
    'get-active-sessions response should include openclaude sessions',
  );
});

test('get-active-sessions includes crewai', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const filePath = path.resolve('server/modules/websocket/services/chat-websocket.service.ts');
  const source = await fs.readFile(filePath, 'utf8');
  assert.ok(
    source.includes('getActiveCrewAISessions') && source.includes('active-sessions'),
    'get-active-sessions response should include crewai sessions',
  );
});
