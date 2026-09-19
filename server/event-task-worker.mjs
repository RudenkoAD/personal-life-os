import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { materializeEventTasks } from '../lib/event-tasks.ts';

/** The task and its receipt share one workspace CAS; retries never replace user edits. */
export function tickEventTasks(database, owner, now = new Date()) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = database
      .prepare('SELECT revision, data FROM workspaces WHERE owner_id = ?')
      .get(owner);
    if (!row) return false;
    const before = JSON.parse(row.data);
    if (before.revision !== Number(row.revision))
      throw new Error('Workspace revision mismatch');
    const after = materializeEventTasks(before, now);
    if (after === before) return false;
    const data = JSON.stringify(after);
    if (data.length > 1800000) return false;
    const result = database
      .prepare(
        'UPDATE workspaces SET revision = ?, data = ?, updated_at = ?, commit_id = ? WHERE owner_id = ? AND revision = ?',
      )
      .run(
        after.revision,
        data,
        now.toISOString(),
        randomUUID(),
        owner,
        before.revision,
      );
    if (Number(result.changes) === 1) return true;
  }
  return false;
}

export function startEventTaskWorker({ path, owner, intervalMs = 60000 }) {
  let database;
  let failed = false;
  const tick = () => {
    try {
      // The HTTP runtime owns schema creation/migrations. Never create a separate workspace.
      if (!existsSync(path)) return;
      if (!database) {
        database = new DatabaseSync(path);
        database.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
      }
      if (
        !database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='workspaces'",
          )
          .get()
      )
        return;
      // Each aggregate has an independent CAS, including shared spaces.
      const owners = owner
        ? [{ owner_id: owner }]
        : database.prepare('SELECT owner_id FROM workspaces').all();
      for (const row of owners) tickEventTasks(database, row.owner_id);
      if (failed) console.info('Event task scheduler recovered');
      failed = false;
    } catch {
      // Never log workspace contents, event names, identities, or credentials.
      if (!failed)
        console.error('Event task scheduler failed; retrying in one minute');
      failed = true;
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  console.info('Event task scheduler started');
  return () => {
    clearInterval(timer);
    database?.close();
  };
}
