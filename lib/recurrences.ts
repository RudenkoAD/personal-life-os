import type { LifeState } from './domain.ts';

/** Pause for any unfinished occurrence returned to Inbox; release exactly once. */
export function reconcileRecurrenceWaits(state: LifeState, now: Date): boolean {
  let changed = false;
  for (const rule of state.recurrences) {
    const waiting = state.cards.filter(
      (c) => c.recurrenceId === rule.id && c.placement === 'inbox' && !c.done,
    );
    if (waiting.length) {
      const id =
        waiting.find((c) => c.id === rule.waitingCardId)?.id ?? waiting[0].id;
      if (rule.waitingCardId !== id || rule.nextAt !== null) changed = true;
      rule.waitingCardId = id;
      rule.nextAt = null;
    } else if (rule.waitingCardId) {
      rule.waitingCardId = null;
      rule.lastReleasedAt = now.toISOString();
      rule.nextAt = new Date(
        now.getTime() + rule.intervalMinutes * 60000,
      ).toISOString();
      changed = true;
    }
  }
  return changed;
}

/** Called on authenticated server reads, then persisted with the workspace CAS.
 * One due task per rule, even after a long absence. No missed-occurrence backlog.
 */
export function materializeRecurrences(
  input: LifeState,
  now = new Date(),
): LifeState {
  if (!input.recurrences?.length) return input;
  const state = structuredClone(input);
  let changed = reconcileRecurrenceWaits(state, now);
  const board = state.boards.find((b) => b.id === 'main');
  if (!board?.columns.length) return input;
  for (const rule of state.recurrences) {
    if (
      rule.waitingCardId ||
      !rule.nextAt ||
      Date.parse(rule.nextAt) > now.getTime()
    )
      continue;
    if (state.cards.length >= 2000) break;
    const cardId = `r_${rule.id}_${rule.generation + 1}`;
    // Stable generation IDs plus the revision CAS make simultaneous reads safe.
    if (state.cards.some((c) => c.id === cardId)) continue;
    state.cards.unshift({
      id: cardId,
      title: rule.title,
      notes: rule.notes,
      type: 'task',
      placement: 'inbox',
      boardId: board.id,
      columnId: board.columns[0].id,
      tags: [...rule.tags],
      steps: [],
      done: false,
      archived: false,
      createdAt: rule.nextAt,
      recurrenceId: rule.id,
    });
    rule.generation++;
    rule.waitingCardId = cardId;
    rule.nextAt = null;
    state.history.unshift({
      at: now.toISOString(),
      actor: 'Повторения',
      text: `Во входящие: ${rule.title}`,
    });
    changed = true;
  }
  if (!changed) return input;
  state.history = state.history.slice(0, 100);
  state.revision = input.revision + 1;
  // Keep a readable workspace even if it has reached its storage limit.
  if (JSON.stringify(state).length > 1800000) return input;
  return state;
}
