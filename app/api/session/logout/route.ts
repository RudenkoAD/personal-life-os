import { runtime, usesPasswordAuth } from '@/lib/runtime-config';
import { publicOrigin, cookieValue } from '@/lib/password-session';
export async function POST(request: Request) {
  if (!usesPasswordAuth()) return new Response(null, { status: 404 });
  const origin = publicOrigin(runtime.PUBLIC_BASE_URL);
  if (request.headers.get('origin') !== origin)
    return new Response(null, { status: 403 });
  return new Response(null, {
    status: 303,
    headers: {
      Location: '/login',
      'Set-Cookie': cookieValue('', origin, true),
      'Cache-Control': 'no-store',
    },
  });
}
