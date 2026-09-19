import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSession,
  createUserSession,
  readSessionUser,
} from '../lib/password-session.ts';

const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
  'base64',
);
const cookie = (value) => `life_os_session=${value}`;

test('v2 sessions identify users and reject tampering, expiry, and wrong keys', async () => {
  const now = 1800000000000;
  const value = await createUserSession('account-v2', key, now);
  assert.equal(
    await readSessionUser(cookie(value), key, 'bootstrap', now),
    'account-v2',
  );
  assert.equal(
    await readSessionUser(cookie(value + 'x'), key, 'bootstrap', now),
    null,
  );
  assert.equal(
    await readSessionUser(cookie(value), key, 'bootstrap', now + 7 * 86400000),
    null,
  );
  assert.equal(
    await readSessionUser(
      cookie(value),
      Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
        'base64',
      ),
      'bootstrap',
      now,
    ),
    null,
  );
});

test('v1 sessions are accepted only for the configured bootstrap account', async () => {
  const now = 1800000000000;
  const value = await createSession('bootstrap', key, now);
  assert.equal(
    await readSessionUser(cookie(value), key, 'bootstrap', now),
    'bootstrap',
  );
  assert.equal(await readSessionUser(cookie(value), key, 'other', now), null);
  assert.equal(await readSessionUser(cookie(value), key, '', now), null);
});
