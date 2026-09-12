import type { NextConfig } from 'next';

const nextConfig: NextConfig =
  process.env.LIFE_OS_TARGET === 'yandex' ? { output: 'standalone' } : {};

export default nextConfig;
