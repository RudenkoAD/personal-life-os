import { rawDb } from '@/db/store';
import { body, errorResponse } from '@/lib/server';
import { runtime, usesPasswordAuth } from '@/lib/runtime-config';
import {
  cookieValue,
  createUserSession,
  publicOrigin,
  passwordHash,
} from '@/lib/password-session';
import {
  normalizeLogin,
  hashToken,
  ensureBootstrapAccount,
} from '@/lib/spaces';

const attempts = new Map<string, { count: number; until: number }>();

export async function POST(request: Request) {
  try {
    if (!usesPasswordAuth()) return new Response(null, { status: 404 });
    const origin = publicOrigin(runtime.PUBLIC_BASE_URL);
    if (request.headers.get('origin') !== origin)
      return new Response(null, { status: 403 });
    const ip =
      request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ??
      'local';
    const clock = Date.now();
    for (const [key, entry] of attempts)
      if (entry.until <= clock) attempts.delete(key);
    const attempt = attempts.get(ip) ?? { count: 0, until: clock + 600000 };
    if (attempt.count >= 20 || (attempts.size >= 2048 && !attempts.has(ip)))
      throw Object.assign(
        new Error('Слишком много попыток. Попробуйте через 10 минут.'),
        { status: 429 },
      );
    attempt.count++;
    attempts.set(ip, attempt);
    await ensureBootstrapAccount();
    const input = (await body(request, 12000)) as Record<string, unknown>;
    const token = typeof input.token === 'string' ? input.token : '';
    const login = normalizeLogin(
      typeof input.login === 'string' ? input.login : '',
    );
    const name = (typeof input.name === 'string' ? input.name : '').trim();
    const password = typeof input.password === 'string' ? input.password : '';
    if (
      !token ||
      token.length > 200 ||
      !login ||
      !name ||
      name.length > 180 ||
      password.length < 12 ||
      password.length > 1024
    )
      throw Object.assign(new Error('Некорректные данные'), { status: 400 });
    const inviteHash = await hashToken(token);
    const db = rawDb(),
      now = new Date().toISOString();
    const invite = await db
      .prepare(
        'SELECT space_id FROM space_invites WHERE hash = ? AND consumed = 0 AND expires_at > ?',
      )
      .bind(inviteHash, now)
      .first<{ space_id: string }>();
    if (!invite)
      throw Object.assign(new Error('Недействительное приглашение'), {
        status: 400,
      });
    const duplicate = await db
      .prepare('SELECT 1 AS found FROM users WHERE login = ?')
      .bind(login)
      .first<{ found: number }>();
    if (duplicate)
      throw Object.assign(new Error('Некорректные данные'), { status: 400 });
    const id = crypto.randomUUID(),
      pass = await passwordHash(password);
    const redemption = crypto.randomUUID();
    const result = await db.batch([
      db
        .prepare(
          "UPDATE space_invites SET consumed = 1, consumed_by = ? WHERE hash = ? AND consumed = 0 AND expires_at > ? AND EXISTS (SELECT 1 FROM spaces s JOIN space_members m ON m.space_id = s.id WHERE s.id = space_invites.space_id AND s.kind = 'shared' AND m.user_id = s.created_by AND m.role = 'owner')",
        )
        .bind(redemption, inviteHash, new Date().toISOString()),
      db
        .prepare(
          'INSERT INTO users (id, login, name, password_hash) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM space_invites WHERE hash = ? AND consumed_by = ?)',
        )
        .bind(id, login, name, pass, inviteHash, redemption),
      db
        .prepare(
          "INSERT INTO spaces (id, name, kind, created_by) SELECT ?, 'Личное', 'private', ? WHERE EXISTS (SELECT 1 FROM space_invites WHERE hash = ? AND consumed_by = ?)",
        )
        .bind(id, id, inviteHash, redemption),
      db
        .prepare(
          "INSERT INTO space_members (space_id, user_id, role) SELECT ?, ?, 'owner' WHERE EXISTS (SELECT 1 FROM space_invites WHERE hash = ? AND consumed_by = ?)",
        )
        .bind(id, id, inviteHash, redemption),
      db
        .prepare(
          "INSERT INTO space_members (space_id, user_id, role) SELECT ?, ?, 'member' WHERE EXISTS (SELECT 1 FROM space_invites WHERE hash = ? AND consumed_by = ?)",
        )
        .bind(invite.space_id, id, inviteHash, redemption),
    ]);
    if (!result.every((r) => r.meta.changes === 1))
      throw Object.assign(new Error('Регистрация не выполнена'), {
        status: 400,
      });
    const session = await createUserSession(
      id,
      runtime.AUTH_SESSION_SECRET ?? '',
    );
    return withCookie(
      { user: { id, login, name }, spaceId: invite.space_id },
      cookieValue(session, origin),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
function withCookie(data: unknown, cookie: string) {
  return new Response(JSON.stringify(data), {
    status: 201,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Set-Cookie': cookie,
    },
  });
}
