import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SESSIONS_DB_PATH = path.resolve('server/modules/database/repositories/sessions.db.ts');
const TYPES_PATH = path.resolve('server/shared/types.ts');

test('P7-01: LLMProvider type includes openclaude and crewai', () => {
  const source = fs.readFileSync(TYPES_PATH, 'utf8');
  assert.ok(source.includes('openclaude'), 'types.ts should include openclaude provider');
  assert.ok(source.includes('crewai'), 'types.ts should include crewai provider');
});

test('P7-04: Sessions DB supports provider-based filtering', () => {
  const source = fs.readFileSync(SESSIONS_DB_PATH, 'utf8');
  assert.ok(
    source.includes('getSessionsByProvider') && source.includes('WHERE provider'),
    'Sessions DB should have getSessionsByProvider with WHERE provider clause',
  );
});

test('P7-02: OpenClaude session synchronizer exists', () => {
  const syncPath = path.resolve('server/modules/providers/list/openclaude/openclaude-session-synchronizer.provider.ts');
  assert.ok(fs.existsSync(syncPath), 'OpenClaude session synchronizer should exist');
  const source = fs.readFileSync(syncPath, 'utf8');
  assert.ok(source.includes('checkpoint') || source.includes('sync') || source.includes('session'),
    'Synchronizer should reference checkpoints or sessions');
});

test('P7-03: CrewAI session synchronizer exists', () => {
  const syncPath = path.resolve('server/modules/providers/list/crewai/crewai-session-synchronizer.provider.ts');
  assert.ok(fs.existsSync(syncPath), 'CrewAI session synchronizer should exist');
});
