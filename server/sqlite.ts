import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function openSqlite(path: string, migrationDirectory: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const sql = new DatabaseSync(path);
  chmodSync(path, 0o600);
  sql.exec('PRAGMA journal_mode=WAL');
  sql.exec('PRAGMA synchronous=FULL');
  sql.exec('PRAGMA foreign_keys=ON');
  sql.exec('PRAGMA busy_timeout=5000');
  sql.exec(
    'CREATE TABLE IF NOT EXISTS __life_os_migrations (name TEXT PRIMARY KEY)',
  );
  for (const name of readdirSync(migrationDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    if (
      sql
        .prepare('SELECT name FROM __life_os_migrations WHERE name = ?')
        .get(name)
    )
      continue;
    sql.exec('BEGIN IMMEDIATE');
    try {
      sql.exec(readFileSync(resolve(migrationDirectory, name), 'utf8'));
      sql
        .prepare('INSERT INTO __life_os_migrations(name) VALUES (?)')
        .run(name);
      sql.exec('COMMIT');
    } catch (error) {
      sql.exec('ROLLBACK');
      sql.close();
      throw error;
    }
  }
  class Query {
    args: (string | number | null | Uint8Array)[] = [];
    readonly source: string;
    constructor(source: string) {
      this.source = source;
    }
    bind(...args: typeof this.args) {
      const next = new Query(this.source);
      next.args = args;
      return next;
    }
    async first(column?: string) {
      const row = sql.prepare(this.source).get(...this.args);
      return column ? (row?.[column] ?? null) : (row ?? null);
    }
    async all() {
      return this.execute();
    }
    async run() {
      return this.execute();
    }
    execute() {
      const statement = sql.prepare(this.source);
      if (statement.columns().length)
        return {
          success: true,
          results: statement.all(...this.args),
          meta: { changes: 0 },
        };
      const result = statement.run(...this.args);
      return {
        success: true,
        results: [],
        meta: {
          changes: Number(result.changes),
          last_row_id: Number(result.lastInsertRowid),
        },
      };
    }
  }
  return {
    prepare: (source: string) => new Query(source),
    async batch(statements: Query[]) {
      sql.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map((statement) => statement.execute());
        sql.exec('COMMIT');
        return results;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => sql.close(),
  };
}
