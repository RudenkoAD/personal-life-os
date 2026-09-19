import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { encryptMigration, secretMatches } from '../lib/migration-export.ts';
import {
  passwordHash,
  verifyPassword,
  createSession,
  validSession,
  safeReturnPath,
  publicOrigin,
  cookieValue,
} from '../lib/password-session.ts';
import { sealCredentials } from '../lib/calendar-credentials.ts';

test('password sessions reject tampering, expiry, another owner and unsafe redirects', async () => {
  const hash = await passwordHash('local fixture password');
  assert.ok(await verifyPassword('local fixture password', hash));
  assert.equal(await verifyPassword('wrong', hash), false);
  assert.equal(await verifyPassword('anything', 'malformed'), false);
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    'base64',
  );
  const now = 1800000000000;
  const value = await createSession('fixture', key, now);
  const cookie = 'life_os_session=' + value;
  assert.ok(await validSession(cookie, 'fixture', key, now));
  assert.equal(await validSession(cookie, 'other', key, now), false);
  assert.equal(
    await validSession(cookie + 'tampered', 'fixture', key, now),
    false,
  );
  assert.equal(
    await validSession(cookie, 'fixture', key, now + 7 * 86400000),
    false,
  );
  for (const path of [
    '//evil.test',
    '/\\evil.test',
    '/api/session/login',
    'https://evil.test',
  ])
    assert.equal(safeReturnPath(path), '/');
  assert.equal(safeReturnPath('/?capture=1'), '/?capture=1');
  assert.throws(() => publicOrigin('http://public.test'));
  assert.throws(() => publicOrigin('https://public.test/a'));
  assert.match(
    cookieValue(value, 'https://public.test'),
    /HttpOnly; SameSite=Lax;.*Secure/,
  );
});

test('encrypted migration preserves exact rows, rejects corruption and cannot overwrite a destination', async () => {
  const root = mkdtempSync(join(tmpdir(), 'life-os-migration-'));
  try {
    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt'],
    );
    const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const privateKey = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const secret = Buffer.from(
      crypto.getRandomValues(new Uint8Array(32)),
    ).toString('base64');
    const owner = 'fixture-owner';
    const state = JSON.stringify({
      revision: 8,
      cards: [{ id: 'archived', archived: true }],
      settings: { autoArchiveCompleted: true },
    });
    const tables = {
      workspaces: [
        {
          owner_id: owner,
          revision: 8,
          data: state,
          updated_at: '2026-09-12T00:00:00Z',
          commit_id: 'fixture',
        },
      ],
      feeds: [
        {
          id: 'feed',
          owner_id: owner,
          url: 'https://fixture.invalid/private.ics?token=fixture',
        },
      ],
      caldav_connections: [
        {
          id: 'caldav',
          owner_id: owner,
          url: 'https://caldav.yandex.ru',
          credentials: await sealCredentials(
            { username: 'fixture', password: 'fixture' },
            secret,
            owner,
            'caldav',
          ),
        },
      ],
      agent_tokens: [
        {
          hash: 'fixture-hash',
          owner_id: owner,
          name: 'Agent',
          scope: 'write',
          created_at: '2026-09-12T00:00:00Z',
        },
      ],
      mutations: [
        {
          owner_id: owner,
          id: 'fixture-mutation',
          hash: 'fixture',
          revision: 8,
        },
      ],
    };
    const snapshot = {
      format: 'life-os-migration-v1',
      ownerId: owner,
      tables,
      environment: {
        CALDAV_ENCRYPTION_KEY: secret,
        CALDAV_ALLOWED_HOSTS: 'caldav-mob.yandex-team.ru',
      },
    };
    const envelope = await encryptMigration(snapshot, publicKey);
    const snapshotPath = join(root, 'snapshot.json'),
      keyPath = join(root, 'key.json'),
      dbPath = join(root, 'data.sqlite'),
      envPath = join(root, 'derived.env');
    writeFileSync(snapshotPath, JSON.stringify(envelope));
    writeFileSync(keyPath, JSON.stringify(privateKey), { mode: 0o600 });
    const run = (database = dbPath, env = envPath) =>
      spawnSync(
        process.execPath,
        [
          resolve('scripts/import-migration.mjs'),
          snapshotPath,
          keyPath,
          database,
          env,
        ],
        { encoding: 'utf8' },
      );
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    const db = new DatabaseSync(dbPath);
    for (const table of Object.keys(tables))
      assert.deepEqual(
        db
          .prepare(`SELECT * FROM ${table}`)
          .all()
          .map((row) => ({ ...row })),
        table === 'agent_tokens'
          ? tables[table].map((row) => ({ ...row, user_id: row.owner_id }))
          : tables[table],
      );
    db.close();
    assert.equal(statSync(dbPath).mode & 0o777, 0o600);
    assert.match(
      readFileSync(envPath, 'utf8'),
      /CALDAV_ALLOWED_HOSTS=caldav-mob.yandex-team.ru/,
    );
    const bytes = readFileSync(dbPath);
    assert.notEqual(run().status, 0);
    assert.deepEqual(readFileSync(dbPath), bytes);
    envelope.ciphertext = 'AAAA' + envelope.ciphertext.slice(4);
    writeFileSync(snapshotPath, JSON.stringify(envelope));
    assert.notEqual(
      run(join(root, 'corrupt.sqlite'), join(root, 'corrupt.env')).status,
      0,
    );
    const mixed = structuredClone(snapshot);
    mixed.tables.feeds[0].owner_id = 'another';
    writeFileSync(
      snapshotPath,
      JSON.stringify(await encryptMigration(mixed, publicKey)),
    );
    assert.notEqual(
      run(join(root, 'mixed.sqlite'), join(root, 'mixed.env')).status,
      0,
    );
    assert.ok(await secretMatches('same', 'same'));
    assert.equal(await secretMatches('wrong', 'same'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
