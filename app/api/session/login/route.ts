import { runtime, usesPasswordAuth } from '@/lib/runtime-config';
import {
  publicOrigin,
  safeReturnPath,
  verifyPassword,
  createSession,
  cookieValue,
} from '@/lib/password-session';

const attempts = new Map<string, { count: number; until: number }>();
export async function POST(request: Request) {
  if (!usesPasswordAuth()) return new Response(null, { status: 404 });
  const origin = publicOrigin(runtime.PUBLIC_BASE_URL);
  if (request.headers.get('origin') !== origin)
    return new Response(null, { status: 403 });
  if (Number(request.headers.get('content-length') ?? 0) > 4096)
    return new Response(null, { status: 413 });
  // The app port is private; the HTTPS proxy overwrites/adds the last hop.
  const ip =
    request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ??
    'local';
  const now = Date.now();
  for (const [key, value] of attempts)
    if (value.until <= now) attempts.delete(key);
  const attempt = attempts.get(ip) ?? { count: 0, until: now + 600000 };
  if (attempt.count >= 10 || (attempts.size >= 2048 && !attempts.has(ip)))
    return new Response(null, {
      status: 303,
      headers: { Location: '/login?error=limit', 'Cache-Control': 'no-store' },
    });
  attempt.count++;
  attempts.set(ip, attempt);
  const reader = request.body?.getReader();
  let text = '',
    bytes = 0;
  if (reader) {
    const decoder = new TextDecoder();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 4096) {
        await reader.cancel();
        return new Response(null, { status: 413 });
      }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  }
  const form = new URLSearchParams(text);
  const target = safeReturnPath(form.get('return_to'));
  const password = form.get('password') ?? '';
  if (!(await verifyPassword(password, runtime.AUTH_PASSWORD_HASH ?? '')))
    return new Response(null, {
      status: 303,
      headers: {
        Location: `/login?error=password&return_to=${encodeURIComponent(target)}`,
        'Cache-Control': 'no-store',
      },
    });
  const session = await createSession(
    runtime.AUTH_OWNER_ID ?? '',
    runtime.AUTH_SESSION_SECRET ?? '',
  );
  attempts.delete(ip);
  return new Response(null, {
    status: 303,
    headers: {
      Location: target,
      'Set-Cookie': cookieValue(session, origin),
      'Cache-Control': 'no-store',
    },
  });
}
