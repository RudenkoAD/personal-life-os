export type CalendarCredentials = { username: string; password: string };
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const context = (owner: string, source: string) =>
  new TextEncoder().encode(JSON.stringify(['caldav-v1', owner, source]));
async function key(value: string) {
  let bytes: Uint8Array;
  try {
    bytes = decode(value);
  } catch {
    throw new Error('Calendar encryption unavailable');
  }
  if (bytes.length !== 32) throw new Error('Calendar encryption unavailable');
  return crypto.subtle.importKey(
    'raw',
    new Uint8Array(bytes).buffer,
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function sealCredentials(
  value: CalendarCredentials,
  secret: string,
  owner: string,
  source: string,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: context(owner, source) },
    await key(secret),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `v1.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
}
export async function openCredentials(
  value: string,
  secret: string,
  owner: string,
  source: string,
): Promise<CalendarCredentials> {
  try {
    const [version, iv, data, extra] = value.split('.');
    if (version !== 'v1' || !iv || !data || extra !== undefined)
      throw new Error();
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: decode(iv),
        additionalData: context(owner, source),
      },
      await key(secret),
      decode(data),
    );
    const result = JSON.parse(new TextDecoder().decode(plaintext));
    if (
      typeof result.username !== 'string' ||
      typeof result.password !== 'string'
    )
      throw new Error();
    return result;
  } catch {
    throw Object.assign(
      new Error(
        'Не удалось открыть подключение CalDAV. Подключите календарь заново.',
      ),
      { status: 503 },
    );
  }
}
