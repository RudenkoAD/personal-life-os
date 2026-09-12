import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { validSession } from '../lib/password-session.ts';
globalThis.proxyConfig = {};
globalThis.proxyUser = null;
registerHooks({
  resolve(spec, context, next) {
    if (spec === 'cloudflare:workers')
      return {
        url:
          'data:text/javascript,' +
          encodeURIComponent('export const env=globalThis.proxyConfig;'),
        shortCircuit: true,
      };
    if (spec === '@/app/chatgpt-auth')
      return {
        url:
          'data:text/javascript,' +
          encodeURIComponent(
            'export async function getChatGPTUser(){return globalThis.proxyUser;}',
          ),
        shortCircuit: true,
      };
    if (spec.startsWith('@/'))
      return {
        url: new URL('../' + spec.slice(2) + '.ts', import.meta.url).href,
        shortCircuit: true,
      };
    return next(spec, context);
  },
});
const { forwardMigration } = await import('../lib/migration-proxy.ts');
test('migration proxy preserves authentication, streamed body and pause without leaking source headers', async () => {
  const source = 'https://source.test',
    destination = 'https://destination.test';
  const config = globalThis.proxyConfig;
  Object.assign(config, {
    MIGRATION_DESTINATION: destination,
    MIGRATION_OWNER_ID: 'fixture',
    MIGRATION_SESSION_SECRET: Buffer.from(
      crypto.getRandomValues(new Uint8Array(32)),
    ).toString('base64'),
  });
  globalThis.proxyUser = { userId: 'fixture' };
  const originalFetch = globalThis.fetch;
  let called = 0,
    captured;
  globalThis.fetch = async (url, init) => {
    called++;
    captured = new Request(url, { ...init, duplex: 'half' });
    return new Response('{"ok":true}', {
      status: 202,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'do-not-forward=secret',
      },
    });
  };
  try {
    const req = (headers = {}, method = 'POST') =>
      new Request(source + '/api/actions?fixture=1', {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        ...(method === 'POST' ? { body: '{"fixture":true}' } : {}),
      });
    const r = await forwardMigration(
      req({
        Origin: source,
        Cookie: 'source-cookie=private',
        'OAI-Sites-Authorization': 'private',
      }),
    );
    assert.equal(r.status, 202);
    assert.equal(r.headers.get('Set-Cookie'), null);
    assert.equal(captured.url, destination + '/api/actions?fixture=1');
    assert.equal(captured.headers.get('Origin'), destination);
    assert.equal(captured.headers.get('OAI-Sites-Authorization'), null);
    assert.ok(
      await validSession(
        captured.headers.get('cookie'),
        'fixture',
        config.MIGRATION_SESSION_SECRET,
      ),
    );
    assert.equal(await captured.text(), '{"fixture":true}');
    const before = called;
    assert.equal((await forwardMigration(req())).status, 403);
    assert.equal(
      (await forwardMigration(req({ Origin: 'https://evil.test' }))).status,
      403,
    );
    assert.equal(called, before);
    globalThis.proxyUser = null;
    await forwardMigration(req({ Authorization: 'Bearer fixture-token' }));
    assert.equal(captured.headers.get('Authorization'), 'Bearer fixture-token');
    assert.equal(captured.headers.get('Cookie'), null);
    assert.equal(
      (
        await forwardMigration(
          req({ Origin: source, Authorization: 'Bearer fixture-token' }),
          true,
        )
      ).status,
      401,
    );
    config.MIGRATION_PAUSED = '1';
    const count = called;
    const paused = await forwardMigration(
      req({ Authorization: 'Bearer fixture-token' }),
    );
    assert.equal(paused.status, 503);
    assert.equal(paused.headers.get('Retry-After'), '15');
    assert.equal(called, count);
    delete config.MIGRATION_PAUSED;
    config.LIFE_OS_RUNTIME = 'node';
    assert.equal(await forwardMigration(req()), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
