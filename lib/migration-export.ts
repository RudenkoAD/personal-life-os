export const migrationTables = [
  'workspaces',
  'feeds',
  'caldav_connections',
  'agent_tokens',
  'mutations',
] as const;

function encode(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
export async function secretMatches(candidate: string, expected: string) {
  if (!candidate || !expected) return false;
  const digest = (value: string) =>
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [a, b] = await Promise.all([digest(candidate), digest(expected)]);
  const left = new Uint8Array(a),
    right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
export async function encryptMigration(value: unknown, publicKey: JsonWebKey) {
  const recipient = await crypto.subtle.importKey(
    'jwk',
    publicKey,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, [
    'encrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode('life-os-migration-v1'),
    },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  const wrappedKey = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    recipient,
    bytes,
  );
  return {
    format: 'life-os-migration-v1',
    wrappedKey: encode(new Uint8Array(wrappedKey)),
    iv: encode(iv),
    ciphertext: encode(new Uint8Array(encrypted)),
  };
}
