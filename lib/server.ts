import { getChatGPTUser } from '@/app/chatgpt-auth';
import { runtime, usesPasswordAuth } from '@/lib/runtime-config';
import { publicOrigin } from '@/lib/password-session';
import { rawDb } from '@/db/store';
import {
  authorizeSpace,
  ensureAccount,
  ensureBootstrapAccount,
} from '@/lib/spaces';
export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export async function identity(
  request: Request,
  write = false,
  accountOnly = false,
) {
  const selectedSpace = request.headers.get('x-life-space');
  if (selectedSpace !== null && (!selectedSpace || selectedSpace.length > 200))
    throw Object.assign(new Error('Нет доступа к пространству'), {
      status: 403,
    });
  const origin = request.headers.get('origin');
  const expectedOrigin = usesPasswordAuth()
    ? publicOrigin(runtime.PUBLIC_BASE_URL)
    : new URL(request.url).origin;
  const auth = request.headers.get('authorization');
  const bearer = !accountOnly && auth?.startsWith('Bearer ');
  if (
    (origin && origin !== expectedOrigin) ||
    (usesPasswordAuth() && write && !bearer && origin !== expectedOrigin)
  )
    throw Object.assign(new Error('Недопустимый источник запроса'), {
      status: 403,
    });
  if (auth?.startsWith('Bearer ') && !accountOnly) {
    if (usesPasswordAuth()) await ensureBootstrapAccount();
    const tokenHash = await hashToken(auth.slice(7));
    const token = await rawDb()
      .prepare(
        'SELECT owner_id, user_id, scope, name FROM agent_tokens WHERE hash = ?',
      )
      .bind(tokenHash)
      .first<{
        owner_id: string;
        user_id: string | null;
        scope: string;
        name: string;
      }>();
    if (!token || (write && token.scope !== 'write'))
      throw Object.assign(new Error('Недостаточно прав токена'), {
        status: 403,
      });
    // A bearer grant targets exactly one space and cannot be retargeted by headers.
    if (!token.user_id || (selectedSpace && selectedSpace !== token.owner_id))
      throw Object.assign(new Error('Недостаточно прав токена'), {
        status: 403,
      });
    const membership = await authorizeSpace(token.user_id, token.owner_id);
    if (!membership)
      throw Object.assign(new Error('Нет доступа к пространству'), {
        status: 403,
      });
    return {
      owner: token.owner_id,
      userId: token.user_id,
      role: membership.role,
      name: 'Агент: ' + token.name,
      agent: true,
      access: { userId: token.user_id, tokenHash },
    };
  }
  const user = await getChatGPTUser();
  if (!user)
    throw Object.assign(
      new Error('Войдите, чтобы открыть личное пространство'),
      { status: 401 },
    );
  const expectedAccount = request.headers.get('x-life-account');
  if (expectedAccount !== null && expectedAccount !== user.userId)
    throw Object.assign(new Error('Аккаунт изменился. Войдите снова.'), {
      status: 401,
    });
  await ensureAccount({ id: user.userId, name: user.displayName });
  const spaceId = selectedSpace ?? user.userId;
  const membership = await authorizeSpace(user.userId, spaceId);
  if (!membership)
    throw Object.assign(new Error('Нет доступа к пространству'), {
      status: 403,
    });
  return {
    owner: spaceId,
    userId: user.userId,
    role: membership.role,
    name: user.displayName,
    agent: false,
    access: { userId: user.userId },
  };
}
export async function body(request: Request, max = 100000) {
  if (Number(request.headers.get('content-length') ?? 0) > max)
    throw Object.assign(new Error('Слишком большой запрос'), { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error('Пустой запрос'), { status: 400 });
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw Object.assign(new Error('Слишком большой запрос'), { status: 413 });
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let pos = 0;
  for (const c of chunks) {
    joined.set(c, pos);
    pos += c.length;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(joined));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('Expected object');
    return parsed;
  } catch {
    throw Object.assign(new Error('Некорректный JSON'), { status: 400 });
  }
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
export function errorResponse(error: unknown) {
  const err = error as Error & { status?: number };
  return json(
    {
      error: err.status
        ? err.message
        : 'Не удалось сохранить данные. Попробуйте ещё раз.',
    },
    err.status ?? 500,
  );
}
