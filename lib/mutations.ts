import {
  applyAction,
  DomainError,
  type Action,
  type LifeState,
} from './domain.ts';
import { reviewPromptState } from './review-tree.ts';
export type Mutation = { id: string; at: string; action: Action };
export function validateMutation(value: unknown): Mutation {
  const m = value as Mutation;
  if (
    !m ||
    typeof m.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      m.id,
    ) ||
    typeof m.at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(m.at) ||
    !Number.isFinite(Date.parse(m.at)) ||
    !m.action ||
    typeof m.action.type !== 'string'
  )
    throw new DomainError('Некорректное действие в очереди');
  return m;
}
export function applyMutation(
  state: LifeState,
  mutation: Mutation,
  actor = 'Вы',
) {
  validateMutation(mutation);
  const ids = new Set([
    ...state.cards.flatMap((c) => [c.id, ...c.steps.map((s) => s.id)]),
    ...state.boards.flatMap((b) => [b.id, ...b.columns.map((c) => c.id)]),
    ...state.tags.map((t) => t.id),
    ...(state.recurrences ?? []).map((r) => r.id),
    ...(state.calendarSeries ?? []).map((r) => r.id),
    ...state.reviews.flatMap((r) => [r.id, ...r.prompts.map((p) => p.id)]),
  ]);
  let slot = 0;
  return applyAction(
    state,
    mutation.action,
    actor,
    new Date(mutation.at),
    () => {
      const id = `m_${mutation.id}_${slot++}`;
      if (ids.has(id))
        throw new DomainError('Объект этого изменения уже существует');
      ids.add(id);
      return id;
    },
  );
}
export function prepareMutation(state: LifeState, action: Action): Mutation {
  const a = structuredClone(action);
  // Record the user's desired result, so rebasing never inverts a newer value.
  if (a.type === 'step.toggle' && a.done === undefined) {
    const step = state.cards
      .find((c) => c.id === a.id)
      ?.steps.find((s) => s.id === a.stepId);
    if (step) a.done = !step.done;
  }
  if (a.type === 'review.prompt' && a.promptId && a.done === undefined) {
    const review = state.reviews.find((r) => r.id === a.id);
    const prompt = review?.prompts.find((p) => p.id === a.promptId);
    // Edits carry an explicit field and must not be turned into toggles.
    if (review && prompt && a.title === undefined && a.parentId === undefined) {
      const stateNow = reviewPromptState(review.prompts, a.promptId as string);
      a.done = stateNow === true ? false : true;
    }
  }
  if (a.type === 'source.toggle' && a.enabled === undefined) {
    const source = state.sources.find((s) => s.id === a.id);
    if (source) a.enabled = !source.enabled;
  }
  return { id: crypto.randomUUID(), at: new Date().toISOString(), action: a };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ':' +
            canonical((value as Record<string, unknown>)[k]),
        )
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
export async function mutationHash(mutation: Mutation) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      canonical({ action: mutation.action, at: mutation.at }),
    ),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
