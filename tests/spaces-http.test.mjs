import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { passwordHash } from '../lib/password-session.ts';

test(
  'standalone HTTP: spaces isolate data, membership, tokens and sessions',
  { skip: process.env.LIFE_OS_TEST_NODE_HTTP !== '1', timeout: 90000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'life-os-spaces-http-'));
    const base = 'http://127.0.0.1:3199';
    const ownerPassword = 'owner fixture password';
    const friendPassword = 'friend fixture password';
    const env = {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '3199',
      DATABASE_PATH: join(root, 'app.sqlite'),
      MIGRATIONS_DIR: resolve('drizzle'),
      MIGRATION_OWNER_ID: 'spaces-http-owner',
      MIGRATION_EXPORT_TOKEN: 'fixture-migration-secret',
      MIGRATION_EXPORT_EXPIRES_AT: new Date(Date.now() + 3600000).toISOString(),
      PUBLIC_BASE_URL: base,
      AUTH_OWNER_ID: 'spaces-http-owner',
      AUTH_SESSION_SECRET: Buffer.from(
        crypto.getRandomValues(new Uint8Array(32)),
      ).toString('base64'),
      AUTH_PASSWORD_HASH: await passwordHash(ownerPassword),
    };
    let server;
    const start = async () => {
      server = spawn(process.execPath, ['dist/standalone/server.js'], {
        env,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      server.stderr.on('data', (c) => (stderr += c));
      for (let i = 0; i < 100; i++) {
        if (server.exitCode !== null) throw new Error(stderr);
        try {
          if ((await fetch(base + '/login')).status === 200) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('Spaces fixture server did not start: ' + stderr);
    };
    const stop = async () => {
      if (server?.exitCode === null) {
        server.kill();
        await new Promise((r) => server.once('exit', r));
      }
    };
    const request = (path, method = 'GET', data, headers = {}) =>
      fetch(base + path, {
        method,
        headers: {
          ...(data ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
        redirect: 'manual',
      });
    const json = async (response) => {
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Expected JSON (${response.status}): ${text}`);
      }
    };
    const login = async (loginName, password, includeLogin = true) => {
      const fields = { password };
      if (includeLogin) fields.login = loginName;
      const response = await fetch(base + '/api/session/login', {
        method: 'POST',
        headers: {
          Origin: base,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(fields),
        redirect: 'manual',
      });
      assert.equal(response.status, 303);
      return response.headers.get('set-cookie').split(';')[0];
    };
    const authHeaders = (cookie, spaceId) => ({
      Cookie: cookie,
      Origin: base,
      ...(spaceId ? { 'X-Life-Space': spaceId } : {}),
    });
    const action = async (cookie, state, title, spaceId) => {
      const response = await request(
        '/api/actions',
        'POST',
        { revision: state.revision, action: { type: 'capture', title } },
        authHeaders(cookie, spaceId),
      );
      assert.equal(response.status, 200);
      return json(response);
    };
    try {
      await start();
      assert.equal((await request('/login')).status, 200);
      assert.equal((await request('/')).status, 307);

      const ownerCookie = await login('owner', ownerPassword);
      const spacesResponse = await request(
        '/api/spaces',
        'GET',
        null,
        authHeaders(ownerCookie),
      );
      assert.equal(spacesResponse.status, 200);
      const spaces = await json(spacesResponse);
      assert.deepEqual(spaces.user, {
        id: 'spaces-http-owner',
        login: 'owner',
        name: 'Я',
      });
      assert.ok(spaces.privateSpaceId);
      assert.ok(
        spaces.spaces.some(
          (s) => s.id === spaces.privateSpaceId && s.kind === 'private',
        ),
      );
      const privateSpaceId = spaces.privateSpaceId;

      // Missing login remains the backwards-compatible owner login form.
      const legacyCookie = await login('owner', ownerPassword, false);
      assert.equal(
        (await request('/api/spaces', 'GET', null, authHeaders(legacyCookie)))
          .status,
        200,
      );

      // All writes require the same origin, including space creation.
      assert.equal(
        (
          await request(
            '/api/spaces',
            'POST',
            { action: 'create', name: 'Shared room' },
            { Cookie: ownerCookie },
          )
        ).status,
        403,
      );
      const sharedCreate = await request(
        '/api/spaces',
        'POST',
        { action: 'create', name: 'Shared room' },
        authHeaders(ownerCookie),
      );
      assert.equal(sharedCreate.status, 201);
      const shared = (await json(sharedCreate)).space;
      assert.equal(shared.name, 'Shared room');
      assert.equal(shared.kind, 'shared');

      const invitationResponse = await request(
        '/api/spaces',
        'POST',
        { action: 'invite', spaceId: shared.id },
        authHeaders(ownerCookie),
      );
      assert.equal(invitationResponse.status, 200);
      const invitation = await json(invitationResponse);
      assert.ok(invitation.token);
      assert.ok(invitation.expiresAt);
      const details = await json(
        await request(
          `/api/spaces?space=${encodeURIComponent(shared.id)}`,
          'GET',
          null,
          authHeaders(ownerCookie),
        ),
      );
      assert.ok(details.members.some((m) => m.id === 'spaces-http-owner'));
      assert.equal(details.invites.length, 1);
      assert.ok(details.invites[0].hash);

      // Registration consumes an invitation exactly once and authenticates the new user.
      const registration = await request(
        '/api/session/register',
        'POST',
        {
          token: invitation.token,
          login: 'friend',
          name: 'Friend',
          password: friendPassword,
        },
        { Origin: base },
      );
      assert.equal(registration.status, 201);
      const friendCookie = registration.headers.get('set-cookie').split(';')[0];
      assert.equal(
        (await request('/', 'GET', null, authHeaders(friendCookie))).status,
        200,
      );
      const friendSpaces = await json(
        await request('/api/spaces', 'GET', null, authHeaders(friendCookie)),
      );
      assert.equal(friendSpaces.user.login, 'friend');
      assert.ok(
        friendSpaces.spaces.some(
          (s) => s.id === shared.id && s.role === 'member',
        ),
      );
      assert.equal(
        (
          await request(
            '/api/spaces',
            'POST',
            { action: 'accept', token: invitation.token },
            authHeaders(friendCookie),
          )
        ).status,
        400,
      );

      // Private data is preserved and is never exposed by guessing another user's id.
      let ownerPrivate = await json(
        await request('/api/state', 'GET', null, authHeaders(ownerCookie)),
      );
      ownerPrivate = await action(
        ownerCookie,
        ownerPrivate,
        'Owner private',
        privateSpaceId,
      );
      const friendPrivateId = friendSpaces.privateSpaceId;
      assert.notEqual(friendPrivateId, privateSpaceId);
      const friendPrivate = await json(
        await request('/api/state', 'GET', null, authHeaders(friendCookie)),
      );
      assert.equal(
        friendPrivate.cards.some((c) => c.title === 'Owner private'),
        false,
      );
      for (const path of ['/api/state', '/api/tokens']) {
        const response = await request(
          path,
          'GET',
          null,
          authHeaders(friendCookie, privateSpaceId),
        );
        assert.ok(
          [401, 403, 404, 405].includes(response.status),
          `${path} leaked guessed private space: ${response.status}`,
        );
      }
      assert.ok(
        [403, 404].includes(
          (
            await request('/api/state', 'GET', null, {
              Cookie: ownerCookie,
              'X-Life-Space': 'not-a-space',
            })
          ).status,
        ),
      );
      assert.ok(
        [403, 404].includes(
          (
            await request(
              '/api/state',
              'GET',
              null,
              authHeaders(friendCookie, 'not-a-space'),
            )
          ).status,
        ),
      );
      assert.equal(
        (
          await request('/api/state', 'GET', null, {
            ...authHeaders(ownerCookie, shared.id),
            'X-Life-Account': 'friend',
          })
        ).status,
        401,
      );
      for (const [path, payload] of [
        ['/api/calendars', { revision: 0, title: 'forged calendar' }],
        ['/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }],
      ]) {
        assert.ok(
          [401, 403].includes(
            (
              await request(
                path,
                'POST',
                payload,
                authHeaders(friendCookie, privateSpaceId),
              )
            ).status,
          ),
          'Endpoint allowed guessed private write',
        );
      }

      // Shared state is visible and editable for both members, with actor names retained.
      let ownerShared = await json(
        await request(
          '/api/state',
          'GET',
          null,
          authHeaders(ownerCookie, shared.id),
        ),
      );
      ownerShared = await action(
        ownerCookie,
        ownerShared,
        'Owner shared',
        shared.id,
      );
      let friendShared = await json(
        await request(
          '/api/state',
          'GET',
          null,
          authHeaders(friendCookie, shared.id),
        ),
      );
      assert.ok(friendShared.cards.some((c) => c.title === 'Owner shared'));
      friendShared = await action(
        friendCookie,
        friendShared,
        'Friend shared',
        shared.id,
      );
      assert.ok(friendShared.cards.some((c) => c.title === 'Friend shared'));
      assert.ok(friendShared.history?.some((h) => h.actor === 'Friend'));

      const ownerToken = await json(
        await request(
          '/api/tokens',
          'POST',
          { name: 'Owner shared write', scope: 'write' },
          authHeaders(ownerCookie, shared.id),
        ),
      );
      const friendToken = await json(
        await request(
          '/api/tokens',
          'POST',
          { name: 'Friend shared write', scope: 'write' },
          authHeaders(friendCookie, shared.id),
        ),
      );
      const readToken = await json(
        await request(
          '/api/tokens',
          'POST',
          { name: 'Friend shared read', scope: 'read' },
          authHeaders(friendCookie, shared.id),
        ),
      );
      const ownerBearer = {
        Authorization: `Bearer ${ownerToken.token}`,
        'X-Life-Space': shared.id,
      };
      const friendBearer = {
        Authorization: `Bearer ${friendToken.token}`,
        'X-Life-Space': shared.id,
      };
      const readBearer = {
        Authorization: `Bearer ${readToken.token}`,
        'X-Life-Space': shared.id,
      };
      assert.equal(
        (await request('/api/state', 'GET', null, ownerBearer)).status,
        200,
      );
      assert.equal(
        (await request('/api/state', 'GET', null, friendBearer)).status,
        200,
      );
      assert.equal(
        (
          await request(
            '/api/actions',
            'POST',
            {
              revision: friendShared.revision,
              action: { type: 'capture', title: 'read-only must fail' },
            },
            readBearer,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request('/api/state', 'GET', null, {
            Authorization: `Bearer ${ownerToken.token}`,
            'X-Life-Space': privateSpaceId,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request('/api/state', 'GET', null, {
            Authorization: `Bearer ${ownerToken.token}`,
            'X-Life-Space': friendPrivateId,
          })
        ).status,
        403,
      );
      const ownerTokens = await json(
        await request(
          '/api/tokens',
          'GET',
          null,
          authHeaders(ownerCookie, shared.id),
        ),
      );
      assert.equal(ownerTokens.length, 3);
      const friendTokens = await json(
        await request(
          '/api/tokens',
          'GET',
          null,
          authHeaders(friendCookie, shared.id),
        ),
      );
      assert.equal(friendTokens.length, 2);
      assert.equal(
        (
          await request(
            '/api/tokens',
            'DELETE',
            { hash: ownerTokens[0].hash },
            authHeaders(friendCookie, shared.id),
          )
        ).status,
        403,
      );
      assert.equal(
        (await request('/api/state', 'GET', null, ownerBearer)).status,
        200,
      );
      assert.equal(
        (
          await request(
            '/api/tokens',
            'DELETE',
            { hash: ownerTokens[0].hash },
            authHeaders(ownerCookie, shared.id),
          )
        ).status,
        200,
      );
      assert.equal(
        (await request('/api/state', 'GET', null, ownerBearer)).status,
        403,
      );
      assert.equal(
        (await request('/api/state', 'GET', null, friendBearer)).status,
        200,
      );

      // Revoking membership immediately cuts the member off from shared data while preserving private data.
      const friendId = friendSpaces.user.id;
      assert.equal(
        (
          await request(
            '/api/spaces',
            'POST',
            {
              action: 'removeMember',
              spaceId: shared.id,
              userId: 'spaces-http-owner',
            },
            authHeaders(friendCookie),
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            '/api/spaces',
            'POST',
            { action: 'removeMember', spaceId: shared.id, userId: friendId },
            authHeaders(ownerCookie),
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await request(
            '/api/state',
            'GET',
            null,
            authHeaders(friendCookie, shared.id),
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            '/api/state',
            'GET',
            null,
            authHeaders(friendCookie, friendPrivateId),
          )
        ).status,
        200,
      );

      // Revoke an unconsumed invite and ensure it cannot create an orphan account.
      const raceInvite = await json(
        await request(
          '/api/spaces',
          'POST',
          { action: 'invite', spaceId: shared.id },
          authHeaders(ownerCookie),
        ),
      );
      const raceRegistration = (loginName) =>
        request(
          '/api/session/register',
          'POST',
          {
            token: raceInvite.token,
            login: loginName,
            name: loginName,
            password: friendPassword,
          },
          { Origin: base },
        );
      const race = await Promise.all([
        raceRegistration('race-winner'),
        raceRegistration('race-loser'),
      ]);
      assert.equal(race.filter((r) => r.status === 201).length, 1);
      assert.equal(
        race.filter((r) => [400, 401, 409].includes(r.status)).length,
        1,
      );
      const loserIndex = race.findIndex((r) =>
        [400, 401, 409].includes(r.status),
      );
      const loserName = loserIndex === 0 ? 'race-winner' : 'race-loser';
      const loserLogin = await fetch(base + '/api/session/login', {
        method: 'POST',
        headers: {
          Origin: base,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          login: loserName,
          password: friendPassword,
        }),
        redirect: 'manual',
      });
      assert.equal(loserLogin.status, 303);
      assert.match(
        loserLogin.headers.get('location') ?? '',
        /^\/login\?error=password/,
      );
      assert.equal(loserLogin.headers.get('set-cookie'), null);
      const sqlite = new DatabaseSync(env.DATABASE_PATH, { readOnly: true });
      assert.equal(
        sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM users WHERE login LIKE 'race-%'",
          )
          .get().count,
        1,
      );
      sqlite.close();

      const secondInvite = await json(
        await request(
          '/api/spaces',
          'POST',
          { action: 'invite', spaceId: shared.id },
          authHeaders(ownerCookie),
        ),
      );
      const ownerDetails = await json(
        await request(
          `/api/spaces?space=${shared.id}`,
          'GET',
          null,
          authHeaders(ownerCookie),
        ),
      );
      assert.equal(
        (
          await request(
            '/api/spaces',
            'POST',
            {
              action: 'revokeInvite',
              spaceId: shared.id,
              hash: ownerDetails.invites.find((i) => i.hash)?.hash,
            },
            authHeaders(ownerCookie),
          )
        ).status,
        200,
      );
      assert.notEqual(secondInvite.token, undefined);
      assert.ok(
        [400, 401].includes(
          (
            await request(
              '/api/session/register',
              'POST',
              {
                token: secondInvite.token,
                login: 'revoked',
                name: 'Revoked',
                password: friendPassword,
              },
              { Origin: base },
            )
          ).status,
        ),
      );

      await stop();
      await start();
      const restoredCookie = await login('owner', ownerPassword);
      const restoredSpaces = await json(
        await request('/api/spaces', 'GET', null, authHeaders(restoredCookie)),
      );
      assert.equal(restoredSpaces.privateSpaceId, privateSpaceId);
      const restoredShared = await json(
        await request(
          '/api/state',
          'GET',
          null,
          authHeaders(restoredCookie, shared.id),
        ),
      );
      assert.ok(restoredShared.cards.some((c) => c.title === 'Owner shared'));
    } finally {
      await stop();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
