import { forwardMigration } from '@/lib/migration-proxy';
import { loadState, acknowledgedMutations } from '@/db/store';
import { identity, json, errorResponse } from '@/lib/server';
export async function GET(request: Request) {
  try {
    const forwarded = await forwardMigration(request);
    if (forwarded) return forwarded;
    const user = await identity(request);
    const state = await loadState(user.owner);
    const pending = new URL(request.url).searchParams.get('mutations');
    if (pending !== null) {
      const ids = [...new Set(pending.split(',').filter(Boolean))];
      if (ids.length > 100 || ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id)))
        return json({ error: 'Некорректная очередь действий' }, 400);
      return json({
        state,
        applied: await acknowledgedMutations(user.owner, ids, state.revision),
      });
    }
    return json(state);
  } catch (e) {
    return errorResponse(e);
  }
}
