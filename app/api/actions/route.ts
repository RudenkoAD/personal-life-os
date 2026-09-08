import { loadState, saveState } from '@/db/store';
import { applyAction } from '@/lib/domain';
import { identity, body, json, errorResponse } from '@/lib/server';
export async function POST(request: Request) {
  try {
    const user = await identity(request, true);
    const { revision, action } = await body(request);
    if (
      user.agent &&
      (action?.type?.startsWith('source.') || action?.type === 'demo')
    )
      return json({ error: 'Действие доступно только в приложении' }, 403);
    const state = await loadState(user.owner);
    if (revision !== state.revision)
      return json(
        { error: 'Данные изменились. Обновите и повторите действие.' },
        409,
      );
    const next = applyAction(state, action, user.name);
    await saveState(
      user.owner,
      state.revision,
      next,
      action.type === 'source.remove'
        ? { kind: 'delete', id: action.id }
        : undefined,
    );
    return json(next);
  } catch (e) {
    return errorResponse(e);
  }
}
