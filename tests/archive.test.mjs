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
const { initialState, applyAction, normalizeState } =
  await import('../lib/domain.ts');
const { loadState, saveState } = await import('../db/store.ts');
const { materializeRecurrences } = await import('../lib/recurrences.ts');
const NOW = new Date('2026-09-10T09:00:00.000Z');
const act = (s, a, now = NOW) => applyAction(s, a, 'archive-test', now);
const setting = (s, enabled) =>
  act(s, { type: 'settings.update', autoArchiveCompleted: enabled });

test('completion archives and reopening preserves Inbox, board and calendar destinations', () => {
  for (const placement of ['inbox', 'board', 'calendar']) {
    let s = act(initialState(NOW), {
      type: placement === 'inbox' ? 'capture' : 'create',
      title: 'Keep my data',
      notes: 'A note',
      tags: ['work'],
    });
    const id = s.cards[0].id;
    if (placement === 'calendar')
      s = act(s, {
        type: 'schedule',
        id,
        start: '2026-09-10T12:00:00+03:00',
        end: '2026-09-10T13:30:00+03:00',
      });
    const original = structuredClone(s.cards[0]);
    s = act(s, { type: 'complete', id, done: true });
    assert.deepEqual(s.cards[0], { ...original, done: true, archived: true });
    s = act(s, { type: 'complete', id, done: false });
    assert.deepEqual(s.cards[0], original);
  }
});

test('disabling affects future completions; enabling archives existing completed cards only', () => {
  let s = act(initialState(NOW), { type: 'capture', title: 'First' });
  const firstId = s.cards[0].id;
  s = act(s, { type: 'complete', id: firstId, done: true });
  s = setting(s, false);
  assert.equal(s.cards.find((c) => c.id === firstId).archived, true);
  s = act(s, { type: 'capture', title: 'Second' });
  const secondId = s.cards[0].id;
  s = act(s, { type: 'complete', id: secondId, done: true });
  assert.equal(s.cards[0].archived, false);
  s = act(s, { type: 'capture', title: 'Unfinished' });
  s = setting(s, true);
  assert.equal(s.cards[0].archived, false);
  assert.equal(s.cards.find((c) => c.id === secondId).archived, true);
  s = setting(s, false);
  s = act(s, { type: 'complete', id: firstId, done: true });
  assert.equal(s.cards.find((c) => c.id === firstId).archived, true);
});

test('legacy defaults enable archiving without overwriting explicit false preferences or flags', () => {
  const legacy = act(initialState(NOW), { type: 'capture', title: 'Legacy' });
  delete legacy.settings;
  delete legacy.cards[0].archived;
  legacy.cards[0].done = true;
  const loaded = normalizeState(structuredClone(legacy));
  assert.equal(loaded.settings.autoArchiveCompleted, true);
  assert.equal(loaded.cards[0].archived, true);
  assert.equal(loaded.revision, legacy.revision);
  assert.deepEqual(normalizeState(structuredClone(loaded)), loaded);
  legacy.settings = { autoArchiveCompleted: false };
  assert.equal(
    normalizeState(structuredClone(legacy)).cards[0].archived,
    false,
  );
  legacy.settings.autoArchiveCompleted = true;
  legacy.cards[0].archived = false;
  assert.equal(normalizeState(legacy).cards[0].archived, false);
});

test('invalid preference is atomic and project archive keeps children and board intact', () => {
  let s = act(initialState(NOW), {
    type: 'create',
    title: 'Project',
    cardType: 'project',
  });
  const project = structuredClone(s.cards[0]);
  s = act(s, { type: 'create', title: 'Child', boardId: project.childBoardId });
  const before = structuredClone(s);
  for (const value of [undefined, null, 'false', 0, {}]) {
    assert.throws(() => setting(s, value), /архивировать/);
    assert.deepEqual(s, before);
  }
  s = act(s, { type: 'complete', id: project.id, done: true });
  assert.deepEqual(s.boards, before.boards);
  assert.deepEqual(s.cards[0], before.cards[0]);
  assert.equal(s.cards.find((c) => c.id === project.id).archived, true);
});

test('archive completion releases recurrence; reopening in Inbox pauses it again', () => {
  let s = act(initialState(NOW), {
    type: 'recurrence.create',
    id: 'archive-rule',
    title: 'Shower',
    intervalMinutes: 4320,
    firstAt: NOW.toISOString(),
  });
  s = materializeRecurrences(s, NOW);
  const id = s.cards[0].id;
  const completeAt = new Date('2026-09-11T09:00:00.000Z');
  s = act(s, { type: 'complete', id, done: true }, completeAt);
  assert.equal(s.cards[0].archived, true);
  assert.equal(s.recurrences[0].nextAt, '2026-09-14T09:00:00.000Z');
  s = act(s, { type: 'complete', id, done: false }, completeAt);
  assert.equal(s.recurrences[0].nextAt, null);
  assert.equal(s.cards[0].archived, false);
  s = act(s, { type: 'complete', id, done: true }, completeAt);
  s = materializeRecurrences(s, new Date('2026-09-14T09:00:00.000Z'));
  assert.equal(s.cards.length, 2);
  assert.equal(s.cards[0].archived, false);
  assert.equal(s.cards[0].done, false);
  assert.equal(s.cards.find((c) => c.id === id).archived, true);
});

test('legacy migration and preference persist per owner across server reloads', async () => {
  const owner = 'archive-' + crypto.randomUUID();
  let before = await loadState(owner, NOW);
  let legacy = act(before, { type: 'capture', title: 'Old completed task' });
  delete legacy.settings;
  delete legacy.cards[0].archived;
  legacy.cards[0].done = true;
  await saveState(owner, before.revision, legacy);
  before = await loadState(owner, NOW);
  assert.equal(before.settings.autoArchiveCompleted, true);
  assert.equal(before.cards[0].archived, true);
  const disabled = setting(before, false);
  await saveState(owner, before.revision, disabled);
  assert.deepEqual(await loadState(owner, NOW), disabled);
  assert.equal(
    (await loadState(owner + '-other', NOW)).settings.autoArchiveCompleted,
    true,
  );
  await assert.rejects(
    () => saveState(owner, before.revision, setting(before, true)),
    (e) => e.status === 409,
  );
  assert.equal(
    (await loadState(owner, NOW)).settings.autoArchiveCompleted,
    false,
  );
});
