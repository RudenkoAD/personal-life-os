import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  existsSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openSqlite } from '../server/sqlite.ts';
import { openCredentials } from '../lib/calendar-credentials.ts';

const [snapshotPath, transferKeyPath, databasePath, environmentPath] =
  process.argv.slice(2);
if (!snapshotPath || !transferKeyPath || !databasePath || !environmentPath)
  throw new Error(
    'Usage: node scripts/import-migration.mjs SNAPSHOT KEY_FILE NEW_DATABASE ENV_OUTPUT',
  );
const envelope = JSON.parse(readFileSync(snapshotPath, 'utf8'));
if (envelope.format !== 'life-os-migration-v1')
  throw new Error('Unsupported snapshot');
const decode = (value) => Uint8Array.from(Buffer.from(value, 'base64'));
if (existsSync(environmentPath) || existsSync(databasePath))
  throw new Error('Destination files must not already exist');
const recipient = await crypto.subtle.importKey(
  'jwk',
  JSON.parse(readFileSync(transferKeyPath, 'utf8')),
  { name: 'RSA-OAEP', hash: 'SHA-256' },
  false,
  ['decrypt'],
);
const keyBytes = await crypto.subtle.decrypt(
  { name: 'RSA-OAEP' },
  recipient,
  decode(envelope.wrappedKey),
);
const transferKey = await crypto.subtle.importKey(
  'raw',
  keyBytes,
  'AES-GCM',
  false,
  ['decrypt'],
);
const plain = await crypto.subtle.decrypt(
  {
    name: 'AES-GCM',
    iv: decode(envelope.iv),
    additionalData: new TextEncoder().encode(envelope.format),
  },
  transferKey,
  decode(envelope.ciphertext),
);
const snapshot = JSON.parse(new TextDecoder().decode(plain));
const columns = {
  workspaces: ['owner_id', 'revision', 'data', 'updated_at', 'commit_id'],
  feeds: ['id', 'owner_id', 'url'],
  caldav_connections: ['id', 'owner_id', 'url', 'credentials'],
  agent_tokens: ['hash', 'owner_id', 'name', 'scope', 'created_at'],
  mutations: ['owner_id', 'id', 'hash', 'revision'],
};
if (
  snapshot.format !== envelope.format ||
  typeof snapshot.ownerId !== 'string' ||
  !snapshot.ownerId ||
  snapshot.tables?.workspaces?.length !== 1
)
  throw new Error('Invalid workspace snapshot');
for (const table of Object.keys(columns)) {
  if (!Array.isArray(snapshot.tables[table]))
    throw new Error('Missing table: ' + table);
  if (snapshot.tables[table].some((row) => row.owner_id !== snapshot.ownerId))
    throw new Error('Mixed owners in snapshot');
}
const workspace = snapshot.tables.workspaces[0];
const state = JSON.parse(workspace.data);
if (state.revision !== workspace.revision) throw new Error('Revision mismatch');
for (const row of snapshot.tables.caldav_connections)
  await openCredentials(
    row.credentials,
    snapshot.environment.CALDAV_ENCRYPTION_KEY,
    row.owner_id,
    row.id,
  );
const allowedHosts = snapshot.environment.CALDAV_ALLOWED_HOSTS ?? '';
if (typeof allowedHosts !== 'string' || /[\r\n]/.test(allowedHosts))
  throw new Error('Invalid calendar host configuration');
const environment = {
  AUTH_OWNER_ID: snapshot.ownerId,
  CALDAV_ENCRYPTION_KEY: snapshot.environment.CALDAV_ENCRYPTION_KEY ?? '',
  CALDAV_ALLOWED_HOSTS: allowedHosts,
};
for (const value of Object.values(environment))
  if (/[\r\n]/.test(value)) throw new Error('Invalid environment value');
const initialized = openSqlite(resolve(databasePath), resolve('drizzle'));
initialized.close();
const db = new DatabaseSync(databasePath);
db.exec('BEGIN IMMEDIATE');
try {
  for (const table of Object.keys(columns)) {
    if (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n)
      throw new Error('Destination must be empty: ' + table);
    const names = columns[table];
    const insert = db.prepare(
      `INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`,
    );
    for (const row of snapshot.tables[table])
      insert.run(...names.map((name) => row[name] ?? null));
    if (
      db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n !==
      snapshot.tables[table].length
    )
      throw new Error('Import count mismatch');
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}
mkdirSync(dirname(resolve(environmentPath)), { recursive: true, mode: 0o700 });
writeFileSync(
  environmentPath,
  Object.entries(environment)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n',
  { mode: 0o600, flag: 'wx' },
);
chmodSync(databasePath, 0o600);
console.log(
  JSON.stringify({
    imported: true,
    revision: state.revision,
    tables: Object.fromEntries(
      Object.keys(columns).map((table) => [
        table,
        snapshot.tables[table].length,
      ]),
    ),
    caldavDecryptionVerified: true,
  }),
);
