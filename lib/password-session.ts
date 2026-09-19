const encoder = new TextEncoder();
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const lifetime = 7 * 86400000;
export const sessionCookie = 'life_os_session';

export function publicOrigin(value: string | undefined) {
  const url = new URL(value ?? '');
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname)
      ))
  )
    throw new Error('A secure PUBLIC_BASE_URL is required');
  return url.origin;
}
export function safeReturnPath(value: string | null) {
  if (!value?.startsWith('/') || value.startsWith('//') || value.length > 2000)
    return '/';
  const base = 'https://life-os.invalid';
  const url = new URL(value, base);
  if (
    url.origin !== base ||
    ['/login', '/api/session/login', '/api/session/logout'].includes(
      url.pathname,
    )
  )
    return '/';
  return url.pathname + url.search + url.hash;
}
export async function passwordHash(
  password: string,
  salt = crypto.getRandomValues(new Uint8Array(16)),
) {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new Uint8Array(salt).buffer,
      iterations: 600000,
    },
    material,
    256,
  );
  return `pbkdf2:600000:${encode(salt)}:${encode(new Uint8Array(bits))}`;
}
export async function verifyPassword(password: string, expected: string) {
  if (!password || password.length > 1024) return false;
  try {
    const [version, iterations, salt, hash, extra] = expected.split(':');
    if (
      version !== 'pbkdf2' ||
      iterations !== '600000' ||
      extra !== undefined ||
      decode(salt).length !== 16 ||
      decode(hash).length !== 32
    )
      return false;
    const actual = await passwordHash(password, decode(salt));
    let diff = actual.length ^ expected.length;
    for (let i = 0; i < actual.length; i++)
      diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}
async function signingKey(secret: string) {
  const bytes = decode(secret);
  if (bytes.length !== 32) throw new Error('A session signing key is required');
  return crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}
export async function createSession(
  owner: string,
  secret: string,
  now = Date.now(),
) {
  if (!owner) throw new Error('An imported owner is required');
  const value = `v1.${now + lifetime}.${crypto.randomUUID()}`;
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(secret),
    encoder.encode(`${owner}\n${value}`),
  );
  return `${value}.${encode(new Uint8Array(signature))}`;
}

export async function createUserSession(
  userId: string,
  secret: string,
  now = Date.now(),
) {
  if (!userId) throw new Error('An imported user is required');
  const value = `v2.${now + lifetime}.${crypto.randomUUID()}`;
  const payload = `${value}\n${userId}`;
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(secret),
    encoder.encode(payload),
  );
  return `${value}.${encode(encoder.encode(userId))}.${encode(new Uint8Array(signature))}`;
}

function cookieFromHeader(cookieHeader: string | null) {
  return (
    cookieHeader
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(sessionCookie + '='))
      ?.slice(sessionCookie.length + 1) ?? null
  );
}

export async function readSessionUser(
  cookieHeader: string | null,
  secret: string,
  bootstrapUserId = '',
  now = Date.now(),
): Promise<string | null> {
  if (!secret) return null;
  try {
    const cookie = cookieFromHeader(cookieHeader);
    if (!cookie || cookie.length > 512) return null;
    const parts = cookie.split('.');
    if (parts[0] === 'v2') {
      const [, expiry, nonce, encodedUser, signature, extra] = parts;
      if (
        extra !== undefined ||
        !/^\d{13}$/.test(expiry) ||
        Number(expiry) <= now ||
        Number(expiry) > now + lifetime ||
        !/^[a-f0-9-]{36}$/.test(nonce)
      )
        return null;
      const userId = new TextDecoder().decode(decode(encodedUser));
      if (!userId || userId.length > 200) return null;
      const ok = await crypto.subtle.verify(
        'HMAC',
        await signingKey(secret),
        decode(signature),
        encoder.encode(`v2.${expiry}.${nonce}\n${userId}`),
      );
      return ok ? userId : null;
    }
    if (parts[0] !== 'v1' || !bootstrapUserId) return null;
    return (await validSession(cookieHeader, bootstrapUserId, secret, now))
      ? bootstrapUserId
      : null;
  } catch {
    return null;
  }
}
export async function validSession(
  cookieHeader: string | null,
  owner: string,
  secret: string,
  now = Date.now(),
) {
  if (!owner || !secret) return false;
  try {
    const cookie = cookieHeader
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(sessionCookie + '='))
      ?.slice(sessionCookie.length + 1);
    if (!cookie || cookie.length > 256) return false;
    const [version, expiry, nonce, signature, extra] = cookie.split('.');
    if (
      version !== 'v1' ||
      extra !== undefined ||
      !/^\d{13}$/.test(expiry) ||
      Number(expiry) <= now ||
      Number(expiry) > now + lifetime ||
      !/^[a-f0-9-]{36}$/.test(nonce)
    )
      return false;
    return await crypto.subtle.verify(
      'HMAC',
      await signingKey(secret),
      decode(signature),
      encoder.encode(`${owner}\n${version}.${expiry}.${nonce}`),
    );
  } catch {
    return false;
  }
}
export function cookieValue(value: string, origin: string, clear = false) {
  return `${sessionCookie}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : lifetime / 1000}${origin.startsWith('https://') ? '; Secure' : ''}`;
}
