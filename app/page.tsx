import Workspace from '@/components/workspace';
import { requireChatGPTUser } from './chatgpt-auth';
export const dynamic = 'force-dynamic';
async function AuthenticatedWorkspace({ capture }: { capture: boolean }) {
  await requireChatGPTUser(capture ? '/?capture=1' : '/');
  return <Workspace />;
}
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ capture?: string }>;
}) {
  const params = await searchParams;
  return <AuthenticatedWorkspace capture={params?.capture === '1'} />;
}
