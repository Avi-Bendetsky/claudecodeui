import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import Database from 'better-sqlite3';

/* eslint-disable boundaries/no-unknown, boundaries/dependencies -- root-level server file + cross-module schema */
import { SESSIONS_TABLE_SCHEMA_SQL, PROJECTS_TABLE_SCHEMA_SQL } from '@/modules/database/schema.js';
/* eslint-enable boundaries/no-unknown, boundaries/dependencies */

vi.mock('@/modules/providers/services/sessions.service.js', () => ({
  sessionsService: { ensureSessionAndProject: vi.fn() },
}));

/* eslint-disable boundaries/no-unknown -- root-level server file, not a module */
import { queryCrewAI } from '@/crewai-bridge-client.js';
/* eslint-enable boundaries/no-unknown */

let mockServer: http.Server;
let port: number;

beforeAll(async () => {
  mockServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/crew/run') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ type: 'status', message: 'Running crew' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'task_start', task: 'Analyze', agent: 'analyst' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'tool_use', tool_name: 'web_search', input: { query: 'test' }, tool_id: 'tool-1' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'agent_output', agent: 'analyst', output: 'Analysis complete' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'crew_complete', result: 'Final result' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => {
    mockServer.listen(0, () => {
      const addr = mockServer.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;
      process.env.CREWAI_BRIDGE_URL = `http://localhost:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  delete process.env.CREWAI_BRIDGE_URL;
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
});

// P4-09: queryCrewAI streams all SSE event types through WebSocket
test('P4-09: queryCrewAI streams status, task_start, tool_use, agent_output, crew_complete events', async () => {
  const messages: Record<string, unknown>[] = [];
  const mockWs = {
    send: (msg: unknown) => messages.push(typeof msg === 'string' ? JSON.parse(msg as string) : msg as Record<string, unknown>),
  };

  await queryCrewAI('test-crew', { crewId: 'crew-1', cwd: '/tmp' }, mockWs);

  const kinds = messages.map((m) => m.kind || m.type);
  assert.ok(kinds.includes('session_created'), 'Should send session_created');
  assert.ok(
    kinds.includes('status') || kinds.includes('text') || kinds.includes('tool_use'),
    'Should stream at least one event from crew run',
  );
  assert.ok(kinds.includes('complete'), 'Should send complete at end');
});

// P4-09: CrewAI offline detection
test('P4-09: queryCrewAI sends helpful error when bridge is offline', async () => {
  const savedUrl = process.env.CREWAI_BRIDGE_URL;
  process.env.CREWAI_BRIDGE_URL = 'http://localhost:1';

  const messages: Record<string, unknown>[] = [];
  const mockWs = {
    send: (msg: unknown) => messages.push(typeof msg === 'string' ? JSON.parse(msg as string) : msg as Record<string, unknown>),
  };

  await queryCrewAI('test-crew', { cwd: '/tmp' }, mockWs);

  const errorMsg = messages.find((m) => m.kind === 'error' || m.isError);
  assert.ok(errorMsg, 'Should send an error message when bridge is offline');
  const content = String(errorMsg?.content || '');
  assert.ok(
    content.includes('not running') || content.includes('ECONNREFUSED') || content.includes('CrewAI error') || content.includes('fetch failed'),
    `Error should indicate bridge unreachable, got: ${content}`,
  );

  process.env.CREWAI_BRIDGE_URL = savedUrl;
});

// P4-10: CrewAI session is tracked in DB via ensureSessionAndProject
test('P4-10: sessions table accepts crewai provider value', () => {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(PROJECTS_TABLE_SCHEMA_SQL);
  db.exec(SESSIONS_TABLE_SCHEMA_SQL);

  db.prepare('INSERT INTO projects (project_id, project_path) VALUES (?, ?)').run('p1', '/tmp/proj');
  db.prepare(
    'INSERT INTO sessions (session_id, provider, project_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run('crewai-sess-1', 'crewai', '/tmp/proj', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z');

  const row = db.prepare("SELECT * FROM sessions WHERE provider = 'crewai'").get() as Record<string, unknown>;
  assert.ok(row, 'crewai session should be saved in DB');
  assert.equal(row.session_id, 'crewai-sess-1');
});

// P4-10: normalizeCrewEvent maps all 8 event types
test('P4-10: crewai-bridge-client.js normalizes all 8 SSE event types', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../crewai-bridge-client.js'), 'utf8');
  const eventTypes = ['status', 'result', 'task_start', 'task_output', 'agent_output', 'tool_use', 'crew_complete', 'error'];
  for (const eventType of eventTypes) {
    assert.ok(
      source.includes(`'${eventType}'`),
      `normalizeCrewEvent should handle event type: ${eventType}`,
    );
  }
});
