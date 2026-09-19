import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const { initialState } = await import('../lib/domain.ts');
const { tickEventTasks } = await import('../server/event-task-worker.mjs');

function databaseWith(state, owner = 'owner') {
  const database = new DatabaseSync(':memory:');
  database.exec(
    'CREATE TABLE workspaces (owner_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, commit_id TEXT)',
  );
  database
    .prepare(
      'INSERT INTO workspaces (owner_id, revision, data, updated_at) VALUES (?, ?, ?, ?)',
    )
    .run(
      owner,
      state.revision,
      JSON.stringify(state),
      '2026-09-01T00:00:00.000Z',
    );
  return { database, owner };
}

test('worker uses node:sqlite CAS and persists one scheduler revision', () => {
  const state = initialState(new Date('2026-09-01T00:00:00.000Z'));
  state.calendarSeries.push({
    id: 'series-1',
    title: 'Событие',
    notes: '',
    location: '',
    tags: [],
    allDay: false,
    startDate: '2026-09-01',
    startTime: '09:00',
    durationMinutes: 60,
    repeat: { frequency: 'none', interval: 1 },
    exceptions: {},
  });
  state.eventTaskRules['series:series-1'] = [
    {
      id: 'rule-1',
      title: 'Подготовиться',
      notes: '',
      minutesBefore: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  ];
  const { database, owner } = databaseWith(state);
  const now = new Date('2026-09-01T06:00:00.000Z');
  assert.equal(tickEventTasks(database, owner, now), true);
  const row = database
    .prepare(
      'SELECT revision, data, commit_id FROM workspaces WHERE owner_id = ?',
    )
    .get(owner);
  assert.equal(Number(row.revision), 1);
  assert.match(row.commit_id, /^[0-9a-f-]{36}$/);
  assert.equal(JSON.parse(row.data).revision, 1);
  assert.equal(JSON.parse(row.data).cards.length, 1);
  assert.equal(tickEventTasks(database, owner, now), false);
  database.close();
});

test('worker reports missing owner without creating a workspace', () => {
  const database = new DatabaseSync(':memory:');
  database.exec(
    'CREATE TABLE workspaces (owner_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, commit_id TEXT)',
  );
  assert.equal(tickEventTasks(database, 'missing', new Date()), false);
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM workspaces').get().count,
    0,
  );
  database.close();
});

test('background scheduler generates without HTTP and keeps receipts after restart', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { startEventTaskWorker } = await import('../server/event-task-worker.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'life-os-event-worker-'));
  const path = join(dir, 'test.sqlite');
  const database = new DatabaseSync(path);
  const state = initialState(new Date());
  const now = Date.now();
  state.events = [{ id: 'fixture', sourceId: 'fixture', uid: 'fixture', title: 'Fixture', start: new Date(now + 60000).toISOString(), end: new Date(now + 3600000).toISOString(), allDay: false, tags: [], location: '' }];
  state.eventTaskRules['external:fixture'] = [{ id: 'prep', title: 'Fixture preparation', notes: '', minutesBefore: 2, createdAt: new Date(now - 120000).toISOString() }];
  database.exec('CREATE TABLE workspaces (owner_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, commit_id TEXT)');
  database.prepare('INSERT INTO workspaces VALUES (?, ?, ?, ?, NULL)').run('fixture', state.revision, JSON.stringify(state), new Date().toISOString());
  let stop;
  try {
    stop = startEventTaskWorker({ path, owner: 'fixture', intervalMs: 10 });
    await new Promise((r) => setTimeout(r, 40));
    const first = database.prepare('SELECT revision, data FROM workspaces').get();
    assert.equal(first.revision, 1);
    assert.equal(JSON.parse(first.data).cards.length, 1);
    stop();
    stop = startEventTaskWorker({ path, owner: 'fixture', intervalMs: 10 });
    await new Promise((r) => setTimeout(r, 40));
    assert.deepEqual(database.prepare('SELECT revision, data FROM workspaces').get(), first);
  } finally {
    stop?.(); database.close(); rmSync(dir, { recursive: true, force: true });
  }
});
