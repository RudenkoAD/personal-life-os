import { env } from 'cloudflare:workers';
import { initialState, type LifeState } from '../lib/domain.ts';
import { materializeRecurrences } from '../lib/recurrences.ts';
export function rawDb() {
  if (!env.DB) throw new Error('Storage unavailable');
  return env.DB as D1Database;
}
async function readState(owner: string): Promise<LifeState> {
  const db = rawDb();
  let row = await db
    .prepare('SELECT data FROM workspaces WHERE owner_id = ?')
    .bind(owner)
    .first<{ data: string }>();
  if (!row) {
    const state = initialState();
    await db
      .prepare(
        'INSERT OR IGNORE INTO workspaces (owner_id, revision, data, updated_at) VALUES (?, 0, ?, ?)',
      )
      .bind(owner, JSON.stringify(state), new Date().toISOString())
      .run();
    row = await db
      .prepare('SELECT data FROM workspaces WHERE owner_id = ?')
      .bind(owner)
      .first<{ data: string }>();
  }
  if (!row) throw new Error('Storage unavailable');
  const state: LifeState = JSON.parse(row.data);
  state.recurrences ??= [];
  return state;
}
export async function loadState(
  owner: string,
  now = new Date(),
): Promise<LifeState> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const before = await readState(owner);
    const after = materializeRecurrences(before, now);
    if (after === before) return before;
    try {
      await saveState(owner, before.revision, after);
      return after;
    } catch (error) {
      if ((error as { status?: number }).status !== 409) throw error;
    }
  }
  // A busy workspace can defer the next check; never overwrite a user's write.
  return readState(owner);
}
export type FeedChange =
  | { kind: 'put'; id: string; url: string }
  | { kind: 'putCalDav'; id: string; url: string; credentials: string }
  | { kind: 'delete'; id: string };
export async function saveState(
  owner: string,
  previous: number,
  state: LifeState,
  feed?: FeedChange,
  mutation?: { id: string; hash: string },
) {
  const data = JSON.stringify(state);
  if (data.length > 1800000)
    throw Object.assign(new Error('Пространство слишком велико'), {
      status: 400,
    });
  const db = rawDb(),
    commitId = crypto.randomUUID();
  const update = db
    .prepare(
      'UPDATE workspaces SET revision = ?, data = ?, updated_at = ?, commit_id = ? WHERE owner_id = ? AND revision = ?',
    )
    .bind(
      state.revision,
      data,
      new Date().toISOString(),
      commitId,
      owner,
      previous,
    );
  const statements = [update];
  // The commit marker ties the credential effect to this exact successful CAS.
  // D1 batch is atomic: a failed statement rolls back both records.
  if (feed?.kind === 'put')
    statements.push(
      db
        .prepare(
          'INSERT INTO feeds (id, owner_id, url) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE owner_id = ? AND commit_id = ?)',
        )
        .bind(feed.id, owner, feed.url, owner, commitId),
    );
  if (feed?.kind === 'putCalDav')
    statements.push(
      db
        .prepare(
          'INSERT INTO caldav_connections (id, owner_id, url, credentials) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE owner_id = ? AND commit_id = ?)',
        )
        .bind(feed.id, owner, feed.url, feed.credentials, owner, commitId),
    );
  if (feed?.kind === 'delete') {
    statements.push(
      db
        .prepare(
          'DELETE FROM feeds WHERE id = ? AND owner_id = ? AND EXISTS (SELECT 1 FROM workspaces WHERE owner_id = ? AND commit_id = ?)',
        )
        .bind(feed.id, owner, owner, commitId),
    );
    statements.push(
      db
        .prepare(
          'DELETE FROM caldav_connections WHERE id = ? AND owner_id = ? AND EXISTS (SELECT 1 FROM workspaces WHERE owner_id = ? AND commit_id = ?)',
        )
        .bind(feed.id, owner, owner, commitId),
    );
  }
  if (mutation)
    statements.push(
      db
        .prepare(
          'INSERT INTO mutations (owner_id, id, hash, revision) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE owner_id = ? AND commit_id = ?)',
        )
        .bind(
          owner,
          mutation.id,
          mutation.hash,
          state.revision,
          owner,
          commitId,
        ),
    );
  const [result] = await db.batch(statements);
  if (!result.meta.changes)
    throw Object.assign(
      new Error(
        'Данные изменились в другом окне. Обновите и повторите действие.',
      ),
      { status: 409 },
    );
}

export async function mutationReceipt(owner: string, id: string) {
  return rawDb()
    .prepare(
      'SELECT hash, revision FROM mutations WHERE owner_id = ? AND id = ?',
    )
    .bind(owner, id)
    .first<{ hash: string; revision: number }>();
}
export async function acknowledgedMutations(
  owner: string,
  ids: string[],
  revision: number,
) {
  if (!ids.length) return [];
  const applied: string[] = [];
  for (let i = 0; i < ids.length; i += 40) {
    const batch = ids.slice(i, i + 40);
    const result = await rawDb()
      .prepare(
        `SELECT id FROM mutations WHERE owner_id = ? AND revision <= ? AND id IN (${batch.map(() => '?').join(',')})`,
      )
      .bind(owner, revision, ...batch)
      .all<{ id: string }>();
    applied.push(...result.results.map((row) => row.id));
  }
  return applied;
}
