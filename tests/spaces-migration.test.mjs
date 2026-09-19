import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

test('spaces migration preserves multiple legacy aggregates, credentials and token ownership', () => {
  const sql = new DatabaseSync(':memory:');
  const dir = new URL('../drizzle/', import.meta.url);
  try {
    for (const name of readdirSync(dir)
      .filter((name) => name.endsWith('.sql') && name < '0004')
      .sort())
      sql.exec(readFileSync(new URL(name, dir), 'utf8'));
    for (const owner of ['legacy-one', 'legacy-two']) {
      sql
        .prepare(
          'INSERT INTO workspaces (owner_id, revision, data, updated_at) VALUES (?, 7, ?, ?)',
        )
        .run(
          owner,
          JSON.stringify({ revision: 7, marker: owner }),
          '2026-09-01',
        );
      sql
        .prepare(
          'INSERT INTO agent_tokens (hash, owner_id, name, scope, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(`hash-${owner}`, owner, 'Agent', 'write', '2026-09-01');
      sql
        .prepare(
          'INSERT INTO caldav_connections (id, owner_id, url, credentials) VALUES (?, ?, ?, ?)',
        )
        .run(
          `calendar-${owner}`,
          owner,
          'https://fixture.invalid',
          `sealed-${owner}`,
        );
    }
    const before = sql
      .prepare('SELECT * FROM workspaces ORDER BY owner_id')
      .all();
    const credentials = sql
      .prepare('SELECT * FROM caldav_connections ORDER BY owner_id')
      .all();
    sql.exec(readFileSync(new URL('0004_accounts_spaces.sql', dir), 'utf8'));
    assert.deepEqual(
      sql.prepare('SELECT * FROM workspaces ORDER BY owner_id').all(),
      before,
    );
    assert.deepEqual(
      sql.prepare('SELECT * FROM caldav_connections ORDER BY owner_id').all(),
      credentials,
    );
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2);
    for (const owner of ['legacy-one', 'legacy-two']) {
      assert.equal(
        sql.prepare('SELECT kind FROM spaces WHERE id = ?').get(owner).kind,
        'private',
      );
      assert.equal(
        sql
          .prepare(
            'SELECT role FROM space_members WHERE user_id = ? AND space_id = ?',
          )
          .get(owner, owner).role,
        'owner',
      );
      assert.equal(
        sql
          .prepare('SELECT user_id FROM agent_tokens WHERE owner_id = ?')
          .get(owner).user_id,
        owner,
      );
      assert.equal(
        sql
          .prepare('SELECT COUNT(*) AS n FROM space_members WHERE user_id = ?')
          .get(owner).n,
        1,
      );
    }
  } finally {
    sql.close();
  }
});
