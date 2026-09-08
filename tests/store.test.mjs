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
const { loadState, saveState, rawDb } = await import('../db/store.ts');
const { applyAction } = await import('../lib/domain.ts');
test('stale CAS cannot insert or delete credentials; failed feed statement rolls back state', async () => {
  const owner = 'store-test';
  let before = await loadState(owner),
    after = applyAction(before, { type: 'capture', title: 'first' });
  await saveState(owner, before.revision, after, {
    kind: 'put',
    id: 'feed-test',
    url: 'https://calendar.google.com/fake-fixture',
  });
  assert.equal(
    (
      await rawDb()
        .prepare('SELECT count(*) AS count FROM feeds WHERE owner_id = ?')
        .bind(owner)
        .first()
    ).count,
    1,
  );
  await assert.rejects(
    () =>
      saveState(owner, before.revision, after, {
        kind: 'put',
        id: 'orphan-test',
        url: 'https://calendar.google.com/fake-fixture',
      }),
    (e) => e.status === 409,
  );
  assert.equal(
    await rawDb()
      .prepare('SELECT id FROM feeds WHERE id = ?')
      .bind('orphan-test')
      .first(),
    null,
  );
  await assert.rejects(
    () =>
      saveState(owner, before.revision, after, {
        kind: 'delete',
        id: 'feed-test',
      }),
    (e) => e.status === 409,
  );
  assert.ok(
    await rawDb()
      .prepare('SELECT id FROM feeds WHERE id = ?')
      .bind('feed-test')
      .first(),
  );
  before = await loadState(owner);
  after = applyAction(before, { type: 'capture', title: 'rolled back' });
  await assert.rejects(() =>
    saveState(owner, before.revision, after, {
      kind: 'put',
      id: 'feed-test',
      url: 'https://calendar.google.com/fake-fixture',
    }),
  );
  assert.deepEqual(await loadState(owner), before);
  await saveState(owner, before.revision, after, {
    kind: 'delete',
    id: 'feed-test',
  });
  assert.equal(
    await rawDb()
      .prepare('SELECT id FROM feeds WHERE id = ?')
      .bind('feed-test')
      .first(),
    null,
  );
  assert.equal((await loadState(owner)).revision, after.revision);
});
