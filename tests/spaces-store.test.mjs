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
const { runtime } = await import('../lib/runtime-config.ts');
const spaces = await import('../lib/spaces.ts');
const { rawDb } = await import('../db/store.ts');

test('accounts provision separate private spaces and bootstrap credentials', async () => {
  const a = await spaces.ensureAccount({ id: 'legacy-a', name: 'A' });
  const b = await spaces.ensureAccount({ id: 'legacy-b', name: 'B' });
  assert.notEqual(a.login, b.login);
  assert.equal((await spaces.authorizeSpace(a.id, a.id)).kind, 'private');
  assert.equal((await spaces.authorizeSpace(b.id, b.id)).kind, 'private');
  runtime.AUTH_OWNER_ID = 'legacy-a';
  runtime.AUTH_PASSWORD_HASH = null;
  assert.equal((await spaces.ensureBootstrapAccount()).login, 'owner');
});

test('shared invite is owner-only, expires, and can be redeemed once', async () => {
  const owner = await spaces.ensureAccount({
    id: 'space-owner',
    name: 'Owner',
  });
  const member = await spaces.ensureAccount({
    id: 'space-member',
    name: 'Member',
  });
  const shared = await spaces.createSharedSpace(owner.id, 'Shared');
  await assert.rejects(
    () => spaces.createInvite(member.id, shared.id),
    (e) => e.status === 403,
  );
  const invite = await spaces.createInvite(owner.id, shared.id);
  assert.deepEqual(await spaces.acceptInvite(member.id, invite.token), {
    spaceId: shared.id,
  });
  await assert.rejects(
    () => spaces.acceptInvite(owner.id, invite.token),
    (e) => e.status === 400,
  );
  const privateInvite = await assert.rejects(
    () => spaces.createInvite(owner.id, owner.id),
    (e) => e.status === 403,
  );
  assert.equal(privateInvite, undefined);
  const expired = await spaces.createInvite(owner.id, shared.id);
  const expiredHash = await spaces.hashToken(expired.token);
  await rawDb()
    .prepare('UPDATE space_invites SET expires_at = ? WHERE hash = ?')
    .bind('2000-01-01T00:00:00.000Z', expiredHash)
    .run();
  await assert.rejects(
    () => spaces.acceptInvite(member.id, expired.token),
    (e) => e.status === 400,
  );
});

test('concurrent redemption has one winner', async () => {
  const owner = await spaces.ensureAccount({ id: 'race-owner', name: 'Owner' });
  const first = await spaces.ensureAccount({ id: 'race-first', name: 'First' });
  const second = await spaces.ensureAccount({
    id: 'race-second',
    name: 'Second',
  });
  const shared = await spaces.createSharedSpace(owner.id, 'Race');
  const invite = await spaces.createInvite(owner.id, shared.id);
  const results = await Promise.allSettled([
    spaces.acceptInvite(first.id, invite.token),
    spaces.acceptInvite(second.id, invite.token),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
});

test('removing a member revokes tokens and blocks re-use of consumed invites', async () => {
  const owner = await spaces.ensureAccount({
    id: 'remove-owner',
    name: 'Owner',
  });
  const member = await spaces.ensureAccount({
    id: 'remove-member',
    name: 'Member',
  });
  const shared = await spaces.createSharedSpace(owner.id, 'Shared remove');
  const invite = await spaces.createInvite(owner.id, shared.id);
  await spaces.acceptInvite(member.id, invite.token);
  await rawDb()
    .prepare(
      'INSERT INTO agent_tokens (hash, owner_id, user_id, name, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(
      'remove-token',
      shared.id,
      member.id,
      't',
      'read',
      new Date().toISOString(),
    )
    .run();
  await spaces.removeMember(owner.id, shared.id, member.id);
  assert.equal(
    await rawDb()
      .prepare('SELECT 1 FROM agent_tokens WHERE hash = ?')
      .bind('remove-token')
      .first(),
    null,
  );
  assert.equal(await spaces.authorizeSpace(member.id, shared.id), null);
  await assert.rejects(
    () => spaces.acceptInvite(member.id, invite.token),
    (e) => e.status === 400,
  );
});
