import { getChatGPTUser } from '@/app/chatgpt-auth';
import { rawDb } from '@/db/store';
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
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    throw Object.assign(new Error('Недопустимый источник запроса'), {
      status: 403,
    });
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ') && !accountOnly) {
    const token = await rawDb()
      .prepare('SELECT owner_id, scope, name FROM agent_tokens WHERE hash = ?')
      .bind(await hashToken(auth.slice(7)))
      .first<{ owner_id: string; scope: string; name: string }>();
    if (!token || (write && token.scope !== 'write'))
      throw Object.assign(new Error('Недостаточно прав токена'), {
        status: 403,
      });
    return { owner: token.owner_id, name: 'Агент: ' + token.name, agent: true };
  }
  const user = await getChatGPTUser();
  if (!user)
    throw Object.assign(
      new Error('Войдите, чтобы открыть личное пространство'),
      { status: 401 },
    );
  return { owner: user.userId, name: 'Вы', agent: false };
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
