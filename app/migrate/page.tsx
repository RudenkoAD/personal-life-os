import { notFound } from 'next/navigation';
import { usesPasswordAuth } from '@/lib/runtime-config';
import MigrationLayout from './transfer';
export const dynamic = 'force-dynamic';
export default function Migrate() {
  if (!usesPasswordAuth()) notFound();
  return <MigrationLayout />;
}
