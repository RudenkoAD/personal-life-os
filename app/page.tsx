import Workspace from '@/components/workspace';
import { requireChatGPTUser } from './chatgpt-auth';
import { runtime, usesPasswordAuth } from '@/lib/runtime-config';
export const dynamic = 'force-dynamic';
async function AuthenticatedWorkspace({ capture }: { capture: boolean }) {
  const user = await requireChatGPTUser(capture ? '/?capture=1' : '/');
  return (
    <Workspace
      key={user.userId}
      ownerId={user.userId}
      passwordAuth={usesPasswordAuth()}
      migrationDestination={
        usesPasswordAuth() ? undefined : runtime.MIGRATION_DESTINATION
      }
    />
  );
}
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ capture?: string }>;
}) {
  const params = await searchParams;
  return <AuthenticatedWorkspace capture={params?.capture === '1'} />;
}
