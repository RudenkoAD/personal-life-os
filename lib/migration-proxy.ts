import { getChatGPTUser } from '@/app/chatgpt-auth';
import { runtime, usesPasswordAuth } from '@/lib/runtime-config';
import {
  createSession,
  publicOrigin,
  sessionCookie,
} from '@/lib/password-session';

// Keep already-open source tabs and their mutation receipts working after cutover.
// Only the operator-configured destination receives authenticated requests.
export async function forwardMigration(request: Request, accountOnly = false) {
  if (usesPasswordAuth()) return null;
  if (runtime.MIGRATION_PAUSED === '1')
    return Response.json(
      { error: 'Перенос данных. Изменения сохранятся после подключения.' },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'Retry-After': '15' },
      },
    );
  if (!runtime.MIGRATION_DESTINATION) return null;
  const destination = publicOrigin(runtime.MIGRATION_DESTINATION);
  const source = new URL(request.url);
  if (destination === source.origin)
    throw new Error('Invalid migration destination');
  const origin = request.headers.get('origin');
  if (origin && origin !== source.origin)
    return Response.json(
      { error: 'Недопустимый источник запроса' },
      { status: 403 },
    );
  const headers = new Headers({
    Origin: destination,
    'Cache-Control': 'no-store',
  });
  const authorization = request.headers.get('authorization');
  if (
    (accountOnly || !authorization?.startsWith('Bearer ')) &&
    !['GET', 'HEAD'].includes(request.method) &&
    origin !== source.origin
  )
    return Response.json(
      { error: 'Недопустимый источник запроса' },
      { status: 403 },
    );
  if (!accountOnly && authorization?.startsWith('Bearer ')) {
    headers.set('Authorization', authorization);
  } else {
    const user = await getChatGPTUser();
    if (!user || user.userId !== runtime.MIGRATION_OWNER_ID)
      return Response.json(
        { error: 'Войдите в личное пространство' },
        { status: 401 },
      );
    const session = await createSession(
      user.userId,
      runtime.MIGRATION_SESSION_SECRET ?? '',
    );
    headers.set('Cookie', `${sessionCookie}=${session}`);
  }
  const type = request.headers.get('content-type');
  if (type) headers.set('Content-Type', type);
  const response = await fetch(destination + source.pathname + source.search, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: 'manual',
    signal: AbortSignal.timeout(25000),
  });
  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type':
        response.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
