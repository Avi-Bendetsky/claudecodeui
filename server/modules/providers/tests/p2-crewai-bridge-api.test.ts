import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/modules/providers/services/sessions.service.js', () => ({
  sessionsService: { ensureSessionAndProject: vi.fn() },
}));

/* eslint-disable boundaries/no-unknown -- root-level server file, not a module */
import {
  fetchCrewList,
  fetchAgentList,
  checkCrewAIHealth,
} from '@/crewai-bridge-client.js';
/* eslint-enable boundaries/no-unknown */

let mockServer: http.Server;
let port: number;

beforeAll(async () => {
  mockServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', crewai_version: '1.5.0' }));
      return;
    }
    if (req.url === '/crew/list') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([
        { id: 'crew-1', name: 'Research Crew', agents: ['researcher', 'writer'], tasks: ['research', 'write'] },
      ]));
      return;
    }
    if (req.url === '/agent/list') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([
        { id: 'agent-1', role: 'researcher', backstory: 'Expert researcher', tools: ['web_search'] },
      ]));
      return;
    }
    if (req.method === 'POST' && req.url === '/crew/run') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ type: 'status', message: 'Starting crew...' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'task_start', task: 'Research', agent: 'researcher' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'task_output', content: 'Found 5 results' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'crew_complete', result: 'Research complete.' })}\n\n`);
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

// P2-08: Test GET /health
test('P2-08: checkCrewAIHealth returns ok from running bridge', async () => {
  const result = await checkCrewAIHealth();
  assert.equal(result.status, 'ok');
});

// P2-09: Test GET /crew/list
test('P2-09: fetchCrewList returns crew array', async () => {
  const crews = await fetchCrewList();
  assert.ok(Array.isArray(crews));
  assert.ok(crews.length > 0);
  assert.ok(crews[0].name, 'Crew should have a name');
});

// P2-09: Test GET /agent/list
test('P2-09: fetchAgentList returns agent array', async () => {
  const agents = await fetchAgentList();
  assert.ok(Array.isArray(agents));
  assert.ok(agents.length > 0);
  assert.ok(agents[0].role, 'Agent should have a role');
});

// P2-10: Test POST /crew/run SSE streaming
test('P2-10: queryCrewAI streams SSE events from bridge', async () => {
  /* eslint-disable boundaries/no-unknown -- root-level server file */
  const { queryCrewAI } = await import('@/crewai-bridge-client.js');
  /* eslint-enable boundaries/no-unknown */
  const messages: unknown[] = [];
  const mockWs = {
    send: (msg: unknown) => messages.push(typeof msg === 'string' ? JSON.parse(msg as string) : msg),
  };

  await queryCrewAI('crew-1', { cwd: '/tmp' }, mockWs);

  assert.ok(messages.length >= 2, `Expected at least 2 messages, got ${messages.length}`);
  const hasComplete = messages.some((m: Record<string, unknown>) => m.kind === 'complete' || (m as Record<string, unknown>).type === 'complete');
  assert.ok(hasComplete, 'Should receive a complete message at end of stream');
});

// P2-01: crewai-bridge has requirements or pyproject
test('P2-01: crewai-bridge has dependency specification', () => {
  const bridgeDir = path.resolve(__dirname, '../../../../crewai-bridge');
  const hasRequirements = fs.existsSync(path.join(bridgeDir, 'requirements.txt'));
  const hasPyproject = fs.existsSync(path.join(bridgeDir, 'pyproject.toml'));
  const apiSource = fs.readFileSync(path.join(bridgeDir, 'api.py'), 'utf8');
  const hasFastapi = apiSource.includes('fastapi') || apiSource.includes('FastAPI');
  assert.ok(
    hasRequirements || hasPyproject || hasFastapi,
    'crewai-bridge should specify Python dependencies (requirements.txt, pyproject.toml, or imports in api.py)',
  );
});
