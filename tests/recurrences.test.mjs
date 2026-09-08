import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(spec, context, next) {
    return spec === 'cloudflare:workers'
      ? {
          url: new URL('./d1-env.mjs', import.meta.url).href,
          shortCircuit: true,
        }
      : next(spec, context);
  },
});

const { initialState, applyAction } = await import('../lib/domain.ts');
const { materializeRecurrences } = await import('../lib/recurrences.ts');
const { loadState, rawDb, saveState } = await import('../db/store.ts');

const at = (s) => new Date(`${s}Z`);
const uid = (name) => `recurrence-test-${name}-${crypto.randomUUID()}`;
function createRule(
  state,
  id,
  firstAt = '2026-09-01T09:00:00.000Z',
  intervalMinutes = 5760,
) {
  return applyAction(
    state,
    {
      type: 'recurrence.create',
      id,
      title: 'Оплатить счёт',
      notes: 'Ежедневная проверка',
      tags: ['life'],
      intervalMinutes,
      firstAt,
    },
    'test',
    at('2026-08-31T09:00:00.000'),
  );
}
function rule(s) {
  return s.recurrences[0];
}
function generated(s) {
  return s.cards.filter((c) => c.recurrenceId);
}

test('Sept 1 generated, Sept 2 completed, next occurrence is Sept 5', () => {
  const id = uid('basic');
  let state = createRule(
    initialState(at('2026-08-31T09:00:00.000')),
    id,
    '2026-09-01T09:00:00.000Z',
    4320,
  );
  state = materializeRecurrences(state, at('2026-09-01T09:00:00.000'));
  const first = generated(state)[0];
  assert.equal(first.createdAt, '2026-09-01T09:00:00.000Z');
  state = applyAction(
    state,
    { type: 'complete', id: first.id, done: true },
    'test',
    at('2026-09-02T09:00:00.000'),
  );
  assert.equal(rule(state).nextAt, '2026-09-05T09:00:00.000Z');
  state = materializeRecurrences(state, at('2026-09-05T09:00:00.000'));
  assert.equal(generated(state).length, 2);
});

test('moving out of Inbox releases once; later completion does not reset interval', () => {
  let state = createRule(initialState(), uid('move'));
  state = materializeRecurrences(state, at('2026-09-01T09:00:00.000'));
  const first = generated(state)[0],
    board = state.boards[0];
  state = applyAction(
    state,
    { type: 'move', id: first.id, boardId: board.id },
    'test',
    at('2026-09-02T09:00:00.000'),
  );
  assert.equal(rule(state).nextAt, '2026-09-06T09:00:00.000Z');
  state = applyAction(
    state,
    { type: 'complete', id: first.id, done: true },
    'test',
    at('2026-09-03T09:00:00.000'),
  );
  assert.equal(rule(state).nextAt, '2026-09-06T09:00:00.000Z');
  state = materializeRecurrences(state, at('2026-09-06T09:00:00.000'));
  assert.equal(generated(state).length, 2);
});

test('returning an unfinished occurrence to Inbox pauses and blocks later materialization', () => {
  let state = createRule(initialState(), uid('pause'));
  state = materializeRecurrences(state, at('2026-09-01T09:00:00.000'));
  const first = generated(state)[0],
    board = state.boards[0];
  state = applyAction(
    state,
    { type: 'move', id: first.id, boardId: board.id },
    'test',
    at('2026-09-02T09:00:00.000'),
  );
  state = applyAction(
    state,
    { type: 'inbox', id: first.id },
    'test',
    at('2026-09-03T09:00:00.000'),
  );
  assert.equal(rule(state).nextAt, null);
  state = materializeRecurrences(state, at('2026-09-20T09:00:00.000'));
  assert.equal(generated(state).length, 1);
  assert.equal(rule(state).waitingCardId, first.id);
});

test('deleting the generated Inbox occurrence resumes from deletion time', () => {
  let state = createRule(initialState(), uid('delete'));
  state = materializeRecurrences(state, at('2026-09-01T09:00:00.000'));
  const first = generated(state)[0];
  state = applyAction(
    state,
    { type: 'delete', id: first.id },
    'test',
    at('2026-09-02T09:00:00.000'),
  );
  assert.equal(rule(state).nextAt, '2026-09-06T09:00:00.000Z');
  state = materializeRecurrences(state, at('2026-09-06T09:00:00.000'));
  assert.equal(generated(state).length, 1);
});

test('multiple historical unfinished returned cards keep the rule paused', () => {
  let state = createRule(initialState(), uid('history'));
  state = materializeRecurrences(state, at('2026-09-01T09:00:00.000'));
  const first = generated(state)[0];
  state.cards.push({
    ...first,
    id: `${first.id}-old`,
    createdAt: '2026-08-01T09:00:00.000Z',
  });
  state.recurrences[0].waitingCardId = null;
  state.recurrences[0].nextAt = '2026-09-02T09:00:00.000Z';
  state = materializeRecurrences(state, at('2026-09-20T09:00:00.000'));
  assert.equal(generated(state).length, 2);
  assert.equal(rule(state).nextAt, null);
});

test('deleting a rule keeps generated tasks but clears recurrence ownership', () => {
  let state = createRule(initialState(), uid('rule-delete'));
  state = materializeRecurrences(state, at('2026-09-01T09:00:00.000'));
  const first = generated(state)[0],
    recurrenceId = rule(state).id;
  state = applyAction(
    state,
    { type: 'recurrence.delete', id: recurrenceId },
    'test',
    at('2026-09-02T09:00:00.000'),
  );
  assert.equal(state.recurrences.length, 0);
  assert.equal(
    state.cards.find((c) => c.id === first.id).recurrenceId,
    undefined,
  );
});

test('future template edits and scope validation apply to the next generated task', () => {
  let state = createRule(initialState(), uid('edit'));
  const id = rule(state).id;
  state = applyAction(
    state,
    {
      type: 'recurrence.update',
      id,
      title: 'Новая версия',
      notes: 'Обновлено',
      tags: ['work'],
    },
    'test',
    at('2026-08-31T10:00:00.000'),
  );
  state = materializeRecurrences(state, at('2026-09-01T09:00:00.000'));
  assert.equal(generated(state)[0].title, 'Новая версия');
  assert.deepEqual(generated(state)[0].tags, ['work']);
  assert.throws(() =>
    applyAction(
      state,
      { type: 'recurrence.update', id, intervalMinutes: 0 },
      'test',
      at('2026-09-01T10:00:00.000'),
    ),
  );
  assert.throws(() =>
    applyAction(
      state,
      { type: 'recurrence.update', id, tags: ['missing'] },
      'test',
      at('2026-09-01T10:00:00.000'),
    ),
  );
});

test('interval is measured from release transition, including a long closed-app gap', () => {
  let state = createRule(
    initialState(),
    uid('release'),
    '2026-09-01T09:00:00.000Z',
    60,
  );
  state = materializeRecurrences(state, at('2026-09-01T09:00:00.000'));
  const first = generated(state)[0];
  state = applyAction(
    state,
    { type: 'complete', id: first.id, done: true },
    'test',
    at('2026-09-10T11:30:00.000'),
  );
  assert.equal(rule(state).nextAt, '2026-09-10T12:30:00.000Z');
  state = materializeRecurrences(state, at('2026-09-11T12:30:00.000'));
  assert.equal(generated(state).length, 2);
  assert.equal(generated(state)[0].createdAt, '2026-09-10T12:30:00.000Z');
});

test('legacy workspace load normalizes missing recurrences', async () => {
  const owner = uid('legacy');
  const state = initialState(at('2026-09-01T09:00:00.000'));
  delete state.recurrences;
  delete state.calendarSeries;
  await rawDb()
    .prepare(
      'INSERT INTO workspaces (owner_id, revision, data, updated_at) VALUES (?, ?, ?, ?)',
    )
    .bind(
      owner,
      state.revision,
      JSON.stringify(state),
      new Date().toISOString(),
    )
    .run();
  const loaded = await loadState(owner, at('2026-09-01T09:00:00.000'));
  assert.deepEqual(loaded.recurrences, []);
  assert.deepEqual(loaded.calendarSeries, []);
});

test('concurrent load materializes one occurrence under CAS', async () => {
  const owner = uid('concurrent');
  const seed = createRule(initialState(), uid('concurrent-rule'));
  const empty = await loadState(owner, at('2026-08-31T09:00:00.000'));
  await saveState(owner, empty.revision, seed);
  const db = rawDb();
  const originalBatch = db.batch;
  let tail = Promise.resolve();
  // The SQLite test hook is synchronous and otherwise rejects overlapping
  // BEGINs. Serialize only the transaction boundary, like D1 does, while
  // retaining the interleaved read/CAS/retry behavior of loadState.
  db.batch = (statements) => {
    const run = tail.then(() => originalBatch.call(db, statements));
    tail = run.catch(() => undefined);
    return run;
  };
  let results;
  try {
    results = await Promise.all([
      loadState(owner, at('2026-09-01T09:00:00.000')),
      loadState(owner, at('2026-09-01T09:00:00.000')),
    ]);
  } finally {
    await tail;
    db.batch = originalBatch;
  }
  const final = await loadState(owner, at('2026-09-01T09:00:00.000'));
  assert.equal(generated(final).length, 1);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].revision, seed.revision + 1);
  assert.deepEqual(results[0], final);
});
