import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
const [source, headerPath, operatorPath, directory, name = 'snapshot'] =
  process.argv.slice(2);
if (
  !source ||
  !headerPath ||
  !operatorPath ||
  !directory ||
  !/^[a-z0-9-]+$/.test(name)
)
  throw new Error(
    'Usage: node scripts/export-migration.mjs HTTPS_ORIGIN HEADERS_JSON OPERATOR_JSON DIRECTORY [NAME]',
  );
const url = new URL(source);
if (
  url.protocol !== 'https:' ||
  url.pathname !== '/' ||
  url.search ||
  url.hash ||
  url.username ||
  url.password
)
  throw new Error('An HTTPS source origin is required');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const keyPath = join(directory, 'recipient-private.json'),
  snapshotPath = join(directory, name + '.encrypted.json');
if (existsSync(snapshotPath))
  throw new Error('Snapshot exists; choose another name');
let publicKey;
if (existsSync(keyPath)) {
  const privateKey = JSON.parse(readFileSync(keyPath, 'utf8'));
  publicKey = {
    kty: privateKey.kty,
    n: privateKey.n,
    e: privateKey.e,
    alg: 'RSA-OAEP-256',
    ext: true,
  };
} else {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  );
  publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
  writeFileSync(
    keyPath,
    JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)),
    { mode: 0o600, flag: 'wx' },
  );
}
const operator = JSON.parse(readFileSync(operatorPath, 'utf8'));
const headers = {
  ...JSON.parse(readFileSync(headerPath, 'utf8')),
  'x-life-os-migration': operator.token,
  'Content-Type': 'application/json',
};
const response = await fetch(url.origin + '/api/migration/export', {
  method: 'POST',
  headers,
  body: JSON.stringify({ publicKey }),
  redirect: 'error',
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw new Error('Export failed: HTTP ' + response.status);
const envelope = await response.json();
if (
  envelope.format !== 'life-os-migration-v1' ||
  !envelope.wrappedKey ||
  !envelope.ciphertext
)
  throw new Error('Invalid export envelope');
writeFileSync(snapshotPath, JSON.stringify(envelope), {
  mode: 0o600,
  flag: 'wx',
});
console.log(
  JSON.stringify({
    exported: true,
    path: resolve(snapshotPath),
    bytes: JSON.stringify(envelope).length,
  }),
);
