import { resolve } from 'node:path';
import { openSqlite } from './sqlite';

let database: ReturnType<typeof openSqlite> | undefined;
export const env = new Proxy({} as Record<string, unknown>, {
  get(_target, key: string) {
    if (key === 'LIFE_OS_RUNTIME') return 'node';
    if (key === 'DB') {
      if (!process.env.DATABASE_PATH)
        throw new Error('DATABASE_PATH is required');
      database ??= openSqlite(
        resolve(process.env.DATABASE_PATH),
        resolve(process.env.MIGRATIONS_DIR ?? 'drizzle'),
      );
      return database;
    }
    return process.env[key];
  },
});
