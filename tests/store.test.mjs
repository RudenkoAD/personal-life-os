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
test('CalDAV credentials follow atomic CAS and owner-scoped deletion', async () => {
  const owner = 'caldav-owner',
    other = 'another-owner';
  const before = await loadState(owner),
    after = applyAction(before, { type: 'capture', title: 'fixture' });
  const put = {
    kind: 'putCalDav',
    id: 'caldav-fixture',
    url: 'https://caldav.yandex.ru/fixture',
    credentials: 'v1.encrypted.fixture',
  };
  await saveState(owner, before.revision, after, put);
  const read = () =>
    rawDb()
      .prepare('SELECT credentials FROM caldav_connections WHERE id = ?')
      .bind(put.id)
      .first();
  assert.equal((await read()).credentials, put.credentials);
  await assert.rejects(
    () =>
      saveState(owner, before.revision, after, { ...put, id: 'stale-caldav' }),
    (e) => e.status === 409,
  );
  assert.equal(
    await rawDb()
      .prepare('SELECT id FROM caldav_connections WHERE id = ?')
      .bind('stale-caldav')
      .first(),
    null,
  );
  await assert.rejects(
    () =>
      saveState(owner, before.revision, after, { kind: 'delete', id: put.id }),
    (e) => e.status === 409,
  );
  assert.ok(await read());
  const otherBefore = await loadState(other);
  await saveState(
    other,
    otherBefore.revision,
    applyAction(otherBefore, { type: 'capture', title: 'other' }),
    { kind: 'delete', id: put.id },
  );
  assert.ok(await read());
  const next = applyAction(after, { type: 'capture', title: 'rollback' });
  await assert.rejects(() => saveState(owner, after.revision, next, put));
  assert.deepEqual(await loadState(owner), after);
  await saveState(owner, after.revision, next, { kind: 'delete', id: put.id });
  assert.equal(await read(), null);
});
test('mutation receipts are owner scoped and atomic with state and credential deletion', async () => {
  const { mutationReceipt, acknowledgedMutations } =
    await import('../db/store.ts');
  const owner = 'receipt-owner',
    id = crypto.randomUUID();
  const before = await loadState(owner),
    after = applyAction(before, { type: 'capture', title: 'Receipt' });
  await saveState(
    owner,
    before.revision,
    after,
    {
      kind: 'put',
      id: 'receipt-feed',
      url: 'https://calendar.google.com/fixture',
    },
    { id, hash: 'hash' },
  );
  assert.equal((await mutationReceipt(owner, id)).revision, after.revision);
  assert.equal(await mutationReceipt('different-owner', id), null);
  assert.deepEqual(
    await acknowledgedMutations(owner, [id], before.revision),
    [],
  );
  assert.deepEqual(await acknowledgedMutations(owner, [id], after.revision), [
    id,
  ]);
  const next = applyAction(after, { type: 'capture', title: 'Must roll back' });
  await assert.rejects(() =>
    saveState(
      owner,
      after.revision,
      next,
      { kind: 'delete', id: 'receipt-feed' },
      { id, hash: 'different' },
    ),
  );
  assert.deepEqual(await loadState(owner), after);
  assert.ok(
    await rawDb()
      .prepare('SELECT id FROM feeds WHERE id = ?')
      .bind('receipt-feed')
      .first(),
  );
  const removeId = crypto.randomUUID();
  await saveState(
    owner,
    after.revision,
    next,
    { kind: 'delete', id: 'receipt-feed' },
    { id: removeId, hash: 'remove' },
  );
  assert.equal(
    await rawDb()
      .prepare('SELECT id FROM feeds WHERE id = ?')
      .bind('receipt-feed')
      .first(),
    null,
  );
  assert.ok(await mutationReceipt(owner, removeId));
});

test('ICS token replacement requires an owned feed and rolls back on failed receipt', async () => {
  const owner = 'replace-feed-owner',
    other = 'replace-feed-other',
    id = 'replace-feed-id';
  const before = await loadState(owner);
  const created = applyAction(before, { type: 'capture', title: 'fixture' });
  const oldUrl =
    'https://lk.dataschool.yandex.ru/users/old-fixture/classes.ics';
  const newUrl =
    'https://lk.dataschool.yandex.ru/users/new-fixture/classes.ics';
  await saveState(
    owner,
    before.revision,
    created,
    { kind: 'put', id, url: oldUrl },
    { id: 'replace-receipt', hash: 'original' },
  );
  const next = applyAction(created, { type: 'capture', title: 'replacement' });
  const stored = () =>
    rawDb().prepare('SELECT url FROM feeds WHERE id = ?').bind(id).first();
  await assert.rejects(
    saveState(owner, created.revision, next, {
      kind: 'replace',
      id: 'missing-feed',
      url: newUrl,
    }),
    (e) => e.status === 409,
  );
  assert.deepEqual(await loadState(owner), created);
  const otherBefore = await loadState(other);
  await assert.rejects(
    saveState(
      other,
      otherBefore.revision,
      applyAction(otherBefore, { type: 'capture', title: 'other' }),
      { kind: 'replace', id, url: newUrl },
    ),
    (e) => e.status === 409,
  );
  assert.deepEqual(await loadState(other), otherBefore);
  assert.equal((await stored()).url, oldUrl);
  await assert.rejects(
    saveState(
      owner,
      created.revision,
      next,
      { kind: 'replace', id, url: newUrl },
      { id: 'replace-receipt', hash: 'duplicate' },
    ),
  );
  assert.equal((await stored()).url, oldUrl);
  assert.deepEqual(await loadState(owner), created);
  await saveState(owner, created.revision, next, {
    kind: 'replace',
    id,
    url: newUrl,
  });
  assert.equal((await stored()).url, newUrl);
});

test('membership and bearer revocation gate the same transaction as task and credential writes', async () => {
  const owner = 'guarded-space', user = 'guarded-user';
  const db = rawDb();
  await db.prepare("INSERT INTO space_members VALUES (?, ?, 'member')").bind(owner, user).run();
  const before = await loadState(owner);
  const after = applyAction(before, { type: 'capture', title: 'Denied after removal' });
  await db.prepare('DELETE FROM space_members WHERE space_id = ? AND user_id = ?').bind(owner, user).run();
  await assert.rejects(() => saveState(owner, before.revision, after,
    { kind: 'put', id: 'guarded-feed', url: 'https://calendar.google.com/fixture' }, undefined, { userId: user }), e => e.status === 403);
  assert.equal((await loadState(owner)).revision, before.revision);
  assert.equal(await db.prepare('SELECT id FROM feeds WHERE id = ?').bind('guarded-feed').first(), null);
  await db.prepare("INSERT INTO space_members VALUES (?, ?, 'member')").bind(owner, user).run();
  await assert.rejects(() => saveState(owner, before.revision, after, undefined, undefined,
    { userId: user, tokenHash: 'revoked-token' }), e => e.status === 403);
  assert.equal((await loadState(owner)).revision, before.revision);
  await saveState(owner, before.revision, after, undefined, undefined, { userId: user });
  assert.equal((await loadState(owner)).cards[0].title, 'Denied after removal');
});
