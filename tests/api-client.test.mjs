import test from 'node:test';
import assert from 'node:assert/strict';
import { readApiResponse, apiRequest, ApiError } from '../lib/api-client.ts';
test('HTML gateway errors never reach JSON.parse or reveal HTML in the message', async () => {
  await assert.rejects(
    () =>
      readApiResponse(
        new Response('<!DOCTYPE html><h1>secret provider content</h1>', {
          status: 403,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    (e) =>
      e instanceof ApiError &&
      e.status === 403 &&
      !e.message.includes('secret') &&
      !e.message.includes('Unexpected token'),
  );
});
test('auth redirects and JSON errors retain status and login intent', async () => {
  await assert.rejects(
    () =>
      readApiResponse(
        new Response(null, {
          status: 302,
          headers: { Location: '/signin-with-chatgpt' },
        }),
      ),
    (e) => e.needsSignIn,
  );
  await assert.rejects(
    () =>
      readApiResponse(
        Response.json({ error: 'Конфликт версии' }, { status: 409 }),
      ),
    (e) => e.status === 409 && e.message === 'Конфликт версии',
  );
  await assert.rejects(
    () => readApiResponse(Response.json({ error: 'Войдите' }, { status: 401 })),
    (e) => e.needsSignIn,
  );
  assert.deepEqual(await readApiResponse(Response.json({ revision: 12 })), {
    revision: 12,
  });
});
test('mutations explicitly request JSON and are never automatically replayed', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (path, options) => {
    calls++;
    assert.equal(path, '/api/actions');
    assert.equal(options.headers.Accept, 'application/json');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'manual');
    assert.equal(JSON.parse(options.body).revision, 7);
    return new Response('<html>blocked</html>', {
      status: 403,
      headers: { 'Content-Type': 'text/html' },
    });
  };
  try {
    await assert.rejects(() => apiRequest('/api/actions', { revision: 7 }));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
