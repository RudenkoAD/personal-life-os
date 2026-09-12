import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { passwordHash } from '../lib/password-session.ts';

test(
  'standalone HTTP: login, spoofed identity, CSRF, CAS, MCP and SQLite restart',
  { skip: process.env.LIFE_OS_TEST_NODE_HTTP !== '1', timeout: 45000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'life-os-http-'));
    const base = 'http://127.0.0.1:3197';
    const env = {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '3197',
      DATABASE_PATH: join(root, 'app.sqlite'),
      MIGRATIONS_DIR: resolve('drizzle'),
      PUBLIC_BASE_URL: base,
      AUTH_OWNER_ID: 'local-http-fixture',
      AUTH_SESSION_SECRET: Buffer.from(
        crypto.getRandomValues(new Uint8Array(32)),
      ).toString('base64'),
      AUTH_PASSWORD_HASH: await passwordHash('test fixture password'),
    };
    let server;
    const start = async () => {
      server = spawn(process.execPath, ['dist/standalone/server.js'], {
        env,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      server.stderr.on('data', (c) => {
        stderr += c;
      });
      for (let i = 0; i < 100; i++) {
        if (server.exitCode !== null) throw new Error(stderr);
        try {
          if ((await fetch(base + '/login')).status === 200) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('Server not ready: ' + stderr);
    };
    const stop = async () => {
      if (server?.exitCode === null) {
        server.kill();
        await new Promise((r) => server.once('exit', r));
      }
    };
    const req = (path, method = 'GET', data, headers = {}) =>
      fetch(base + path, {
        method,
        headers: {
          ...(data ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
        redirect: 'manual',
      });
    try {
      await start();
      assert.equal((await req('/api/state')).status, 401);
      assert.equal(
        (
          await req('/api/state', 'GET', null, {
            'oai-authenticated-user-id': 'local-http-fixture',
            'oai-authenticated-user-email': 'spoof@fixture.invalid',
          })
        ).status,
        401,
      );
      assert.equal(
        (await req('/api/migration/export', 'POST', {})).status,
        404,
      );
      const login = () =>
        fetch(base + '/api/session/login', {
          method: 'POST',
          headers: {
            Origin: base,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ password: 'test fixture password' }),
          redirect: 'manual',
        });
      const response = await login();
      assert.equal(response.status, 303);
      assert.equal(response.headers.get('location'), '/');
      const cookie = response.headers.get('set-cookie').split(';')[0];
      const auth = { Cookie: cookie, Origin: base };
      let state = await (await req('/api/state', 'GET', null, auth)).json();
      const payload = {
        revision: state.revision,
        action: { type: 'capture', title: 'HTTP fixture' },
      };
      assert.equal(
        (await req('/api/actions', 'POST', payload, { Cookie: cookie })).status,
        403,
      );
      assert.equal(
        (
          await req('/api/actions', 'POST', payload, {
            Cookie: cookie,
            Origin: 'https://evil.invalid',
          })
        ).status,
        403,
      );
      const races = await Promise.all([
        req('/api/actions', 'POST', payload, auth),
        req('/api/actions', 'POST', payload, auth),
      ]);
      assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
      state = await (await req('/api/state', 'GET', null, auth)).json();
      assert.equal(
        state.cards.filter((c) => c.title === 'HTTP fixture').length,
        1,
      );
      const token = await (
        await req(
          '/api/tokens',
          'POST',
          { name: 'Fixture agent', scope: 'write' },
          auth,
        )
      ).json();
      assert.ok(token.token);
      const bearer = { Authorization: 'Bearer ' + token.token };
      assert.equal((await req('/api/tokens', 'GET', null, bearer)).status, 401);
      assert.equal(
        (
          await req(
            '/api/mcp',
            'POST',
            { jsonrpc: '2.0', id: 1, method: 'tools/list' },
            bearer,
          )
        ).status,
        200,
      );
      await stop();
      await start();
      const restored = await (
        await req('/api/state', 'GET', null, bearer)
      ).json();
      assert.deepEqual(restored, state);
      assert.equal(
        (await req('/api/session/logout', 'POST', {}, { Cookie: cookie }))
          .status,
        403,
      );
      const logout = await req('/api/session/logout', 'POST', {}, auth);
      assert.equal(logout.status, 303);
      assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    } finally {
      await stop();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
