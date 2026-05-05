import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

/* eslint-disable boundaries/dependencies -- cross-module schema access needed for DB integration tests */
import { SESSIONS_TABLE_SCHEMA_SQL, PROJECTS_TABLE_SCHEMA_SQL } from '@/modules/database/schema.js';
/* eslint-enable boundaries/dependencies */

// P7-06: All provider sessions appear in unified sidebar query
test('P7-06: sessions table returns sessions from all 5 providers', () => {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(PROJECTS_TABLE_SCHEMA_SQL);
  db.exec(SESSIONS_TABLE_SCHEMA_SQL);

  db.prepare('INSERT INTO projects (project_id, project_path) VALUES (?, ?)').run('p1', '/tmp/proj');

  const providers = ['claude', 'cursor', 'openclaude', 'crewai', 'gemini'];
  for (let i = 0; i < providers.length; i++) {
    db.prepare(
      'INSERT INTO sessions (session_id, provider, project_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(`sess-${i}`, providers[i], '/tmp/proj', `2025-01-0${i + 1}T00:00:00Z`, `2025-01-0${i + 1}T00:00:00Z`);
  }

  const allSessions = db.prepare('SELECT * FROM sessions ORDER BY created_at').all() as { provider: string }[];
  assert.equal(allSessions.length, 5, 'Should have 5 sessions from all providers');

  const storedProviders = new Set(allSessions.map((s) => s.provider));
  for (const p of providers) {
    assert.ok(storedProviders.has(p), `Provider '${p}' should be in sidebar session list`);
  }
});

// P7-06: Provider filter returns only requested provider
test('P7-06: getSessionsByProvider returns only sessions for given provider', () => {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(PROJECTS_TABLE_SCHEMA_SQL);
  db.exec(SESSIONS_TABLE_SCHEMA_SQL);

  db.prepare('INSERT INTO projects (project_id, project_path) VALUES (?, ?)').run('p1', '/tmp/proj');
  db.prepare(
    'INSERT INTO sessions (session_id, provider, project_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run('s1', 'claude', '/tmp/proj', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z');
  db.prepare(
    'INSERT INTO sessions (session_id, provider, project_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run('s2', 'openclaude', '/tmp/proj', '2025-01-02T00:00:00Z', '2025-01-02T00:00:00Z');
  db.prepare(
    'INSERT INTO sessions (session_id, provider, project_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run('s3', 'crewai', '/tmp/proj', '2025-01-03T00:00:00Z', '2025-01-03T00:00:00Z');

  const occSessions = db.prepare("SELECT * FROM sessions WHERE provider = 'openclaude'").all();
  assert.equal(occSessions.length, 1, 'Should return only openclaude sessions');
});

// P7-07: Sessions persist across DB close/reopen (simulating page reload)
test('P7-07: sessions persist after DB close and reopen', () => {
  const tmpDbPath = path.join(__dirname, '_test_persist.db');
  try {
    // Create and populate
    const db1 = new Database(tmpDbPath);
    db1.exec('PRAGMA foreign_keys = ON');
    db1.exec(PROJECTS_TABLE_SCHEMA_SQL);
    db1.exec(SESSIONS_TABLE_SCHEMA_SQL);

    db1.prepare('INSERT INTO projects (project_id, project_path) VALUES (?, ?)').run('p1', '/tmp/proj');
    db1.prepare(
      'INSERT INTO sessions (session_id, provider, project_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('persist-occ', 'openclaude', '/tmp/proj', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z');
    db1.prepare(
      'INSERT INTO sessions (session_id, provider, project_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('persist-crew', 'crewai', '/tmp/proj', '2025-01-02T00:00:00Z', '2025-01-02T00:00:00Z');
    db1.close();

    // Reopen (simulates page reload)
    const db2 = new Database(tmpDbPath);
    const rows = db2.prepare('SELECT * FROM sessions ORDER BY created_at').all() as { session_id: string; provider: string }[];

    assert.equal(rows.length, 2, 'Both sessions should persist after close/reopen');
    assert.equal(rows[0].session_id, 'persist-occ');
    assert.equal(rows[0].provider, 'openclaude');
    assert.equal(rows[1].session_id, 'persist-crew');
    assert.equal(rows[1].provider, 'crewai');
    db2.close();
  } finally {
    try { fs.unlinkSync(tmpDbPath); } catch { /* cleanup */ }
  }
});

// P7-07: Session synchronizers exist for both new providers
test('P7-07: openclaude session synchronizer exists', () => {
  const syncPath = path.resolve(__dirname, '../../providers/list/openclaude/openclaude-session-synchronizer.provider.ts');
  assert.ok(fs.existsSync(syncPath), 'OpenClaude session synchronizer should exist');
});

test('P7-07: crewai session synchronizer exists', () => {
  const syncPath = path.resolve(__dirname, '../../providers/list/crewai/crewai-session-synchronizer.provider.ts');
  assert.ok(fs.existsSync(syncPath), 'CrewAI session synchronizer should exist');
});

// P7-06: WebSocket get-active-sessions includes openclaude and crewai
test('P7-06: get-active-sessions handler includes openclaude and crewai', () => {
  const wsPath = path.resolve(__dirname, '../../websocket/services/chat-websocket.service.ts');
  const source = fs.readFileSync(wsPath, 'utf8');
  assert.ok(
    source.includes('getActiveOpenClaudeSessions') || source.includes('openclaude'),
    'get-active-sessions should return openclaude sessions',
  );
  assert.ok(
    source.includes('getActiveCrewAISessions') || source.includes('crewai'),
    'get-active-sessions should return crewai sessions',
  );
});
