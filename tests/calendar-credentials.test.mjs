import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sealCredentials,
  openCredentials,
} from '../lib/calendar-credentials.ts';
test('credentials encrypt with fresh IVs and are bound to owner andsource', async () => {
  const key = Buffer.alloc(32, 7).toString('base64'),
    value = { username: 'юзер', password: ' private-password ' };
  const a = await sealCredentials(value, key, 'a', 's'),
    b = await sealCredentials(value, key, 'a', 's');
  assert.notEqual(a, b);
  assert.equal(a.includes(value.password), false);
  assert.deepEqual(await openCredentials(a, key, 'a', 's'), value);
  for (const [owner, source] of [
    ['other', 's'],
    ['a', 'other'],
  ])
    await assert.rejects(() => openCredentials(a, key, owner, source));
  await assert.rejects(() =>
    openCredentials(a, Buffer.alloc(32, 8).toString('base64'), 'a', 's'),
  );
  await assert.rejects(() =>
    openCredentials(a.slice(0, -4) + 'AAAA', key, 'a', 's'),
  );
});
