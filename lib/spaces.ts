import { rawDb } from '../db/store.ts';
import { runtime } from './runtime-config.ts';

export type Account = { id: string; login: string; name: string };
export type Space = {
  id: string;
  name: string;
  kind: 'private' | 'shared';
  role: 'owner' | 'member';
};

function cleanLogin(login: string | undefined) {
  return (login ?? '').trim().toLocaleLowerCase('en-US');
}
function cleanName(name: string | undefined, fallback: string) {
  const value = (name ?? '').trim();
  return value.slice(0, 180) || fallback;
}
function assertId(value: string) {
  if (!value || value.length > 200)
    throw Object.assign(new Error('Некорректный идентификатор'), {
      status: 400,
    });
}
export function normalizeLogin(login: string) {
  const value = cleanLogin(login);
  if (
    value.length > 180 ||
    Array.from(value).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    throw Object.assign(new Error('Некорректный логин'), { status: 400 });
  return value;
}
async function hashToken(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

export async function getAccount(id: string): Promise<Account | null> {
  return (
    (await rawDb()
      .prepare('SELECT id, login, name FROM users WHERE id = ?')
      .bind(id)
      .first<Account>()) ?? null
  );
}

export async function ensureAccount(input: {
  id: string;
  login?: string;
  name?: string;
  passwordHash?: string | null;
}): Promise<Account> {
  assertId(input.id);
  const login = normalizeLogin(input.login ?? `legacy-${input.id}`);
  const name = cleanName(input.name, input.id);
  const db = rawDb();
  const existing = await getAccount(input.id);
  if (existing) {
    if (
      input.name !== undefined ||
      (input.login !== undefined && existing.login === '')
    ) {
      await db
        .prepare('UPDATE users SET login = ?, name = ? WHERE id = ?')
        .bind(
          input.login !== undefined && existing.login === ''
            ? login
            : existing.login,
          input.name !== undefined ? name : existing.name,
          input.id,
        )
        .run();
    }
    if (input.passwordHash && !(await existingPassword(input.id))) {
      await db
        .prepare(
          'UPDATE users SET password_hash = ? WHERE id = ? AND password_hash IS NULL',
        )
        .bind(input.passwordHash, input.id)
        .run();
    }
    await rawDb().batch([
      db
        .prepare(
          'INSERT OR IGNORE INTO spaces (id, name, kind, created_by) VALUES (?, ?, ?, ?)',
        )
        .bind(input.id, 'Личное', 'private', input.id),
      db
        .prepare(
          "INSERT OR IGNORE INTO space_members (space_id, user_id, role) VALUES (?, ?, 'owner')",
        )
        .bind(input.id, input.id),
    ]);
    return (await getAccount(input.id))!;
  }
  try {
    await db
      .prepare(
        'INSERT INTO users (id, login, name, password_hash) VALUES (?, ?, ?, ?)',
      )
      .bind(input.id, login, name, input.passwordHash ?? null)
      .run();
  } catch (error) {
    const again = await getAccount(input.id);
    if (again) return ensureAccount(input);
    throw error;
  }
  await db.batch([
    db
      .prepare(
        'INSERT OR IGNORE INTO spaces (id, name, kind, created_by) VALUES (?, ?, ?, ?)',
      )
      .bind(input.id, 'Личное', 'private', input.id),
    db
      .prepare(
        "INSERT OR IGNORE INTO space_members (space_id, user_id, role) VALUES (?, ?, 'owner')",
      )
      .bind(input.id, input.id),
  ]);
  return (await getAccount(input.id))!;
}

async function existingPassword(id: string) {
  const row = await rawDb()
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(id)
    .first<{ password_hash: string | null }>();
  return !!row?.password_hash;
}

export async function ensureBootstrapAccount() {
  const id = runtime.AUTH_OWNER_ID ?? '';
  if (!id) return null;
  const account = await ensureAccount({ id, login: 'owner', name: 'Я' });
  if (runtime.AUTH_PASSWORD_HASH) {
    await rawDb()
      .prepare(
        'UPDATE users SET password_hash = ? WHERE id = ? AND password_hash IS NULL',
      )
      .bind(runtime.AUTH_PASSWORD_HASH, id)
      .run();
  }
  if (account.login.startsWith('legacy-') || account.login === '') {
    await rawDb()
      .prepare(
        "UPDATE users SET login = 'owner' WHERE id = ? AND NOT EXISTS (SELECT 1 FROM users WHERE login = 'owner' AND id <> ?)",
      )
      .bind(id, id)
      .run();
  }
  return (await getAccount(id))!;
}

export async function authorizeSpace(
  userId: string,
  spaceId: string,
): Promise<Space | null> {
  assertId(userId);
  assertId(spaceId);
  return (
    (await rawDb()
      .prepare(
        `SELECT s.id, s.name, s.kind, m.role FROM spaces s JOIN space_members m ON m.space_id = s.id WHERE m.user_id = ? AND s.id = ?`,
      )
      .bind(userId, spaceId)
      .first<Space>()) ?? null
  );
}

export async function listSpaces(userId: string): Promise<Space[]> {
  return (
    await rawDb()
      .prepare(
        `SELECT s.id, s.name, s.kind, m.role FROM spaces s JOIN space_members m ON m.space_id = s.id WHERE m.user_id = ? ORDER BY CASE s.kind WHEN 'private' THEN 0 ELSE 1 END, s.name`,
      )
      .bind(userId)
      .all<Space>()
  ).results;
}

export async function createSharedSpace(userId: string, name: string) {
  const value = name.trim();
  if (!value || value.length > 180)
    throw Object.assign(new Error('Некорректное название'), { status: 400 });
  const id = crypto.randomUUID();
  const db = rawDb();
  await db.batch([
    db
      .prepare(
        "INSERT INTO spaces (id, name, kind, created_by) VALUES (?, ?, 'shared', ?)",
      )
      .bind(id, value, userId),
    db
      .prepare(
        "INSERT INTO space_members (space_id, user_id, role) VALUES (?, ?, 'owner')",
      )
      .bind(id, userId),
  ]);
  return (await authorizeSpace(userId, id))!;
}

export async function createInvite(userId: string, spaceId: string) {
  const space = await authorizeSpace(userId, spaceId);
  if (!space || space.role !== 'owner' || space.kind !== 'shared')
    throw Object.assign(new Error('Недостаточно прав'), { status: 403 });
  const token = crypto.randomUUID() + crypto.randomUUID().replaceAll('-', '');
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  const hash = await hashToken(token);
  await rawDb()
    .prepare(
      'INSERT INTO space_invites (hash, space_id, expires_at, created_by, consumed) VALUES (?, ?, ?, ?, 0)',
    )
    .bind(hash, spaceId, expiresAt, userId)
    .run();
  return { token, expiresAt };
}

export async function acceptInvite(userId: string, token: string) {
  if (!token || token.length > 200)
    throw Object.assign(new Error('Недействительное приглашение'), {
      status: 400,
    });
  const hash = await hashToken(token);
  const db = rawDb();
  const now = new Date().toISOString();
  const invite = await db
    .prepare(
      'SELECT space_id FROM space_invites WHERE hash = ? AND consumed = 0 AND expires_at > ?',
    )
    .bind(hash, now)
    .first<{ space_id: string }>();
  if (!invite)
    throw Object.assign(new Error('Недействительное приглашение'), {
      status: 400,
    });
  const existing = await getAccount(userId);
  if (!existing)
    throw Object.assign(new Error('Аккаунт не найден'), { status: 401 });
  if (await authorizeSpace(userId, invite.space_id))
    throw Object.assign(new Error('Вы уже участник пространства'), {
      status: 400,
    });
  const redemption = crypto.randomUUID();
  const result = await db.batch([
    db
      .prepare(
        "UPDATE space_invites SET consumed = 1, consumed_by = ? WHERE hash = ? AND consumed = 0 AND expires_at > ? AND EXISTS (SELECT 1 FROM spaces s JOIN space_members m ON m.space_id = s.id WHERE s.id = ? AND s.kind = 'shared' AND m.user_id = s.created_by AND m.role = 'owner') AND NOT EXISTS (SELECT 1 FROM space_members WHERE space_id = space_invites.space_id AND user_id = ?)",
      )
      .bind(redemption, hash, new Date().toISOString(), invite.space_id, userId),
    db
      .prepare(
        "INSERT OR IGNORE INTO space_members (space_id, user_id, role) SELECT ?, ?, 'member' WHERE EXISTS (SELECT 1 FROM space_invites WHERE hash = ? AND consumed_by = ?)",
      )
      .bind(invite.space_id, userId, hash, redemption),
  ]);
  if (!result[0]?.meta.changes || !result[1]?.meta.changes)
    throw Object.assign(new Error('Недействительное приглашение'), {
      status: 400,
    });
  return { spaceId: invite.space_id };
}

export async function removeMember(
  ownerId: string,
  spaceId: string,
  userId: string,
) {
  const space = await authorizeSpace(ownerId, spaceId);
  if (
    !space ||
    space.role !== 'owner' ||
    space.kind !== 'shared' ||
    ownerId === userId
  )
    throw Object.assign(new Error('Недостаточно прав'), { status: 403 });
  const db = rawDb();
  await db.batch([
    db
      .prepare(
        "DELETE FROM space_members WHERE space_id = ? AND user_id = ? AND role = 'member'",
      )
      .bind(spaceId, userId),
    db
      .prepare('DELETE FROM agent_tokens WHERE owner_id = ? AND user_id = ?')
      .bind(spaceId, userId),
  ]);
}
export { hashToken };
