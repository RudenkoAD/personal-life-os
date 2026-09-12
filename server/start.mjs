const required = [
  'DATABASE_PATH',
  'PUBLIC_BASE_URL',
  'AUTH_OWNER_ID',
  'AUTH_PASSWORD_HASH',
  'AUTH_SESSION_SECRET',
];
for (const key of required)
  if (!process.env[key])
    throw new Error(`Missing runtime configuration: ${key}`);
const origin = new URL(process.env.PUBLIC_BASE_URL);
if (
  origin.protocol !== 'https:' ||
  origin.pathname !== '/' ||
  origin.search ||
  origin.hash ||
  origin.username ||
  origin.password
)
  throw new Error('PUBLIC_BASE_URL must be an HTTPS origin');
if (
  Buffer.from(process.env.AUTH_SESSION_SECRET, 'base64').length !== 32 ||
  !/^pbkdf2:600000:/.test(process.env.AUTH_PASSWORD_HASH)
)
  throw new Error('Invalid authentication configuration');
await import('./server.js');
