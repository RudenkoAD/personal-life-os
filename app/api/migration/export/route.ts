import { env } from 'cloudflare:workers';
import { rawDb } from '@/db/store';
import { body, identity, json, errorResponse } from '@/lib/server';
import {
  migrationTables,
  secretMatches,
  encryptMigration,
} from '@/lib/migration-export';

// Disabled unless the operator explicitly enables a short migration window.
// A normal app/agent token alone must never reveal calendar credentials.
export async function POST(request: Request) {
  try {
    const config = env as unknown as Record<string, string | undefined>;
    const expiry = Date.parse(config.MIGRATION_EXPORT_EXPIRES_AT ?? '');
    if (
      !config.MIGRATION_EXPORT_TOKEN ||
      !Number.isFinite(expiry) ||
      expiry <= Date.now()
    )
      return json({ error: 'Перенос не включён' }, 404);
    if (
      !(await secretMatches(
        request.headers.get('x-life-os-migration') ?? '',
        config.MIGRATION_EXPORT_TOKEN,
      ))
    )
      return json({ error: 'Нет доступа' }, 403);
    const user = await identity(request, true);
    if (user.owner !== config.MIGRATION_OWNER_ID)
      return json({ error: 'Нет доступа' }, 403);
    const input = await body(request, 2048);
    const publicKey = input.publicKey;
    if (
      !publicKey ||
      publicKey.kty !== 'RSA' ||
      publicKey.d ||
      publicKey.p ||
      publicKey.q ||
      typeof publicKey.n !== 'string' ||
      publicKey.n.length < 342 ||
      publicKey.n.length > 684 ||
      publicKey.e !== 'AQAB'
    )
      return json({ error: 'Некорректный ключ переноса' }, 400);
    const db = rawDb();
    const rows = await db.batch(
      migrationTables.map((table) =>
        db
          .prepare(`SELECT * FROM ${table} WHERE owner_id = ?`)
          .bind(user.owner),
      ),
    );
    const tables = Object.fromEntries(
      migrationTables.map((table, i) => [table, rows[i].results]),
    );
    if (tables.workspaces.length !== 1)
      throw new Error('Expected one workspace');
    return json(
      await encryptMigration(
        {
          format: 'life-os-migration-v1',
          capturedAt: new Date().toISOString(),
          ownerId: user.owner,
          tables,
          environment: {
            CALDAV_ENCRYPTION_KEY: config.CALDAV_ENCRYPTION_KEY ?? null,
            CALDAV_ALLOWED_HOSTS: config.CALDAV_ALLOWED_HOSTS ?? '',
          },
        },
        {
          kty: 'RSA',
          n: publicKey.n,
          e: publicKey.e,
          alg: 'RSA-OAEP-256',
          ext: true,
        },
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
