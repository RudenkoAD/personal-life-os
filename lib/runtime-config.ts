import { env } from 'cloudflare:workers';
export const runtime = env as unknown as Record<string, string | undefined>;
export function usesPasswordAuth() {
  return runtime.LIFE_OS_RUNTIME === 'node';
}
