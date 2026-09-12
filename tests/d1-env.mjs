import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
const sql = new DatabaseSync(':memory:');
const dir = new URL('../drizzle/', import.meta.url);
for (const name of readdirSync(dir)
  .filter((n) => n.endsWith('.sql'))
  .sort())
  sql.exec(readFileSync(new URL(name, dir), 'utf8'));
class Query {
  constructor(source) {
    this.source = source;
    this.args = [];
  }
  bind(...args) {
    this.args = args;
    return this;
  }
  async first() {
    return sql.prepare(this.source).get(...this.args) ?? null;
  }
  async all() {
    return { results: sql.prepare(this.source).all(...this.args) };
  }
  async run() {
    const r = sql.prepare(this.source).run(...this.args);
    return { meta: { changes: Number(r.changes) } };
  }
}
export const env = {
  DB: {
    prepare: (q) => new Query(q),
    batch: async (statements) => {
      sql.exec('BEGIN');
      try {
        const results = [];
        for (const q of statements) results.push(await q.run());
        sql.exec('COMMIT');
        return results;
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    },
  },
};

if (process.env.LIFE_OS_TEST_SQLITE === '1') {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { openSqlite } = await import('../server/sqlite.ts');
  const directory = mkdtempSync(join(tmpdir(), 'life-os-store-'));
  env.DB = openSqlite(join(directory, 'test.sqlite'), fileURLToPath(dir));
  process.on('exit', () => {
    env.DB.close();
    rmSync(directory, { recursive: true });
  });
}
