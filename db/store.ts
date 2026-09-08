import { env } from 'cloudflare:workers';
import { initialState, type LifeState } from '../lib/domain.ts';
export function rawDb() {
  if (!env.DB) throw new Error('Storage unavailable');
  return env.DB as D1Database;
}
export async function loadState(owner: string): Promise<LifeState> {
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
  return JSON.parse(row.data);
}
export type FeedChange =
  | { kind: 'put'; id: string; url: string }
  | { kind: 'delete'; id: string };
export async function saveState(
  owner: string,
  previous: number,
  state: LifeState,
  feed?: FeedChange,
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
  if (feed?.kind === 'delete')
    statements.push(
      db
        .prepare(
          'DELETE FROM feeds WHERE id = ? AND owner_id = ? AND EXISTS (SELECT 1 FROM workspaces WHERE owner_id = ? AND commit_id = ?)',
        )
        .bind(feed.id, owner, owner, commitId),
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
