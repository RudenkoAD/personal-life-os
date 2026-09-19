import { forwardMigration } from '@/lib/migration-proxy';
import { loadState, saveState, mutationReceipt } from '@/db/store';
import { applyAction } from '@/lib/domain';
import { applyMutation, validateMutation, mutationHash } from '@/lib/mutations';
import { identity, body, json, errorResponse } from '@/lib/server';
export async function POST(request: Request) {
  try {
    const forwarded = await forwardMigration(request);
    if (forwarded) return forwarded;
    const user = await identity(request, true);
    const payload = await body(request);
    const mutation = payload.mutation
      ? validateMutation(payload.mutation)
      : undefined;
    const action = mutation?.action ?? payload.action,
      revision = payload.revision;
    if (
      user.agent &&
      (action?.type?.startsWith('source.') || action?.type === 'demo')
    )
      return json({ error: 'Действие доступно только в приложении' }, 403);
    const hash = mutation ? await mutationHash(mutation) : undefined;
    const replay = async () => {
      if (!mutation) return null;
      const receipt = await mutationReceipt(user.owner, mutation.id);
      if (!receipt) return null;
      if (receipt.hash !== hash)
        return json(
          { error: 'Номер действия уже использован для другого изменения.' },
          422,
        );
      // Return current state so an acknowledgement never rewinds unrelated edits.
      return json(await loadState(user.owner));
    };
    const duplicate = await replay();
    if (duplicate) return duplicate;
    const state = await loadState(user.owner);
    if (revision !== state.revision)
      return json(
        { error: 'Данные изменились. Обновите и повторите действие.' },
        409,
      );
    const next = mutation
      ? applyMutation(state, mutation, user.name)
      : applyAction(state, action, user.name);
    try {
      await saveState(
        user.owner,
        state.revision,
        next,
        action.type === 'source.remove'
          ? { kind: 'delete', id: action.id }
          : undefined,
        mutation ? { id: mutation.id, hash: hash! } : undefined,
        user.access,
      );
    } catch (e) {
      const raced = await replay();
      if (raced) return raced;
      throw e;
    }
    return json(next);
  } catch (e) {
    return errorResponse(e);
  }
}
