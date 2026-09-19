import type { CalendarEvent, LifeState } from './domain.ts';
import {
  dateAdd,
  eventOnDate,
  expandEventSeries,
  isOccurrenceDate,
} from './calendar-events.ts';

export type EventTaskRule = {
  id: string;
  title: string;
  notes: string;
  minutesBefore: number;
  createdAt: string;
  catchUpOccurrence?: string;
};
export type EventTaskTarget = {
  kind: 'series' | 'occurrence' | 'external' | 'card';
  id: string;
  occurrenceDate?: string;
};
type Candidate = {
  occurrence: string;
  start: string;
  end: string;
  allDay: boolean;
  tags: string[];
};
const dateKey = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
const targetKey = (target: EventTaskTarget) =>
  target.kind === 'occurrence'
    ? `occurrence:${target.id}:${target.occurrenceDate}`
    : `${target.kind}:${target.id}`;
const localCandidate = (event: CalendarEvent): Candidate => ({
  ...event,
  occurrence: event.occurrenceDate!,
});

function candidates(state: LifeState, key: string, now: Date): Candidate[] {
  if (key.startsWith('series:')) {
    const series = state.calendarSeries.find((s) => s.id === key.slice(7));
    if (!series) return [];
    const today = dateKey(now);
    // Expansion includes seven days of overlap and moved exceptions. The end is
    // exclusive, covering every possible 365-day lead without exceeding its cap.
    const to =
      dateAdd(today, 366) < '2200-01-01' ? dateAdd(today, 366) : '2200-01-01';
    return expandEventSeries([series], today, to).map(localCandidate);
  }
  if (key.startsWith('occurrence:')) {
    const split = key.lastIndexOf(':');
    const series = state.calendarSeries.find(
      (s) => s.id === key.slice(11, split),
    );
    const event = series && eventOnDate(series, key.slice(split + 1));
    return event ? [localCandidate(event)] : [];
  }
  if (key.startsWith('external:')) {
    const event = state.events.find((e) => e.id === key.slice(9));
    if (!event) return [];
    const source = state.sources.find((s) => s.id === event.sourceId);
    if (source?.enabled === false) return [];
    return [
      {
        ...event,
        occurrence: event.id,
        tags: [...new Set([...event.tags, ...(source?.tags ?? [])])],
      },
    ];
  }
  if (key.startsWith('card:')) {
    const card = state.cards.find((c) => c.id === key.slice(5));
    if (
      !card ||
      card.placement !== 'calendar' ||
      card.done ||
      card.archived ||
      !card.start ||
      !card.end
    )
      return [];
    return [
      {
        occurrence: card.id,
        start: card.start,
        end: card.end,
        allDay: false,
        tags: card.tags,
      },
    ];
  }
  return [];
}

export function setEventTaskRules(
  state: LifeState,
  action: Record<string, unknown>,
  now = new Date(),
) {
  const target = action.target as EventTaskTarget;
  if (
    !target ||
    !['series', 'occurrence', 'external', 'card'].includes(target.kind) ||
    typeof target.id !== 'string' ||
    !target.id
  )
    throw new Error('Некорректная цель задач события');
  const key = targetKey(target);
  if (
    target.kind === 'series' &&
    !state.calendarSeries.some((x) => x.id === target.id)
  )
    throw new Error('Серия не найдена');
  if (target.kind === 'occurrence') {
    const series = state.calendarSeries.find((x) => x.id === target.id);
    if (
      !series ||
      typeof target.occurrenceDate !== 'string' ||
      !isOccurrenceDate(series, target.occurrenceDate)
    )
      throw new Error('Повтор не найден');
  }
  if (
    target.kind === 'external' &&
    !state.events.some((x) => x.id === target.id)
  )
    throw new Error('Событие не найдено');
  if (
    target.kind === 'card' &&
    !state.cards.some(
      (x) =>
        x.id === target.id &&
        x.placement === 'calendar' &&
        !x.done &&
        !x.archived,
    )
  )
    throw new Error('Карточка должна быть запланирована');
  if (!Array.isArray(action.rules) || action.rules.length > 8)
    throw new Error('Максимум 8 правил');
  if (
    !Object.hasOwn(state.eventTaskRules ?? {}, key) &&
    Object.keys(state.eventTaskRules ?? {}).length >= 2000
  )
    throw new Error('Слишком много правил задач');
  const ids = new Set<string>();
  const oldRules = state.eventTaskRules?.[key] ?? [];
  const nearest = candidates(state, key, now).find(
    (e) => Date.parse(e.end) > now.getTime(),
  )?.occurrence;
  const rules = (action.rules as Record<string, unknown>[]).map((r) => {
    if (!r || typeof r !== 'object' || Array.isArray(r))
      throw new Error('Некорректное правило');
    if (typeof r.id !== 'string' || !r.id || ids.has(r.id) || r.id.length > 100)
      throw new Error('Некорректный идентификатор правила');
    ids.add(r.id);
    if (
      typeof r.title !== 'string' ||
      !r.title.trim() ||
      r.title.trim().length > 200
    )
      throw new Error('Некорректное название правила');
    if (
      r.notes !== undefined &&
      (typeof r.notes !== 'string' || r.notes.length > 8000)
    )
      throw new Error('Некорректные заметки правила');
    if (
      !Number.isInteger(r.minutesBefore) ||
      Number(r.minutesBefore) < 0 ||
      Number(r.minutesBefore) > 525600
    )
      throw new Error('Некорректный срок правила');
    const old = oldRules.find((x) => x.id === r.id);
    const same = old && old.minutesBefore === Number(r.minutesBefore);
    const catchUpOccurrence = same ? old.catchUpOccurrence : nearest;
    return {
      id: r.id,
      title: r.title.trim(),
      notes: typeof r.notes === 'string' ? r.notes : '',
      minutesBefore: Number(r.minutesBefore),
      createdAt: same ? old.createdAt : now.toISOString(),
      ...(catchUpOccurrence ? { catchUpOccurrence } : {}),
    };
  });
  state.eventTaskRules ??= {};
  state.eventTaskRules[key] = rules;
  return 'Изменены задачи события';
}

export function materializeEventTasks(
  input: LifeState,
  now = new Date(),
): LifeState {
  if (!Object.values(input.eventTaskRules ?? {}).some((rules) => rules.length))
    return input;
  const state = structuredClone(input);
  state.eventTaskRuns ??= {};
  const board = state.boards.find((b) => b.id === 'main');
  if (!board?.columns.length || state.cards.length >= 2000) return input;
  let changed = false;
  for (const [key, rules] of Object.entries(state.eventTaskRules ?? {})) {
    if (!rules.length) continue;
    const events = candidates(state, key, now);
    const identity = key.startsWith('occurrence:')
      ? `series:${key.slice(11, key.lastIndexOf(':'))}`
      : key;
    for (const event of events) {
      if (
        key.startsWith('series:') &&
        Object.hasOwn(
          state.eventTaskRules!,
          `occurrence:${key.slice(7)}:${event.occurrence}`,
        )
      )
        continue;
      const start = Date.parse(event.start),
        end = Date.parse(event.end);
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= now.getTime()
      )
        continue;
      const anchor = event.allDay
        ? Date.parse(`${dateKey(new Date(start))}T09:00:00+03:00`)
        : start;
      for (const rule of rules) {
        const due = anchor - rule.minutesBefore * 60000;
        if (!Number.isFinite(due) || due > now.getTime()) continue;
        // A new rule catches up just its pinned nearest occurrence. Subsequent
        // ticks cannot drain a backlog of occurrences whose due time was earlier.
        if (
          Date.parse(rule.createdAt) > due &&
          rule.catchUpOccurrence !== event.occurrence
        )
          continue;
        const rk = JSON.stringify([identity, rule.id, event.occurrence]);
        if (state.eventTaskRuns[rk]) continue;
        if (state.cards.length >= 2000) return input;
        const id = `et_${encodeURIComponent(rk)}`;
        if (!state.cards.some((c) => c.id === id))
          state.cards.unshift({
            id,
            title: rule.title,
            notes: rule.notes,
            type: 'task',
            placement: 'inbox',
            boardId: board.id,
            columnId: board.columns[0].id,
            tags: [...event.tags],
            steps: [],
            done: false,
            archived: false,
            createdAt: now.toISOString(),
          });
        state.eventTaskRuns[rk] = id;
        changed = true;
      }
    }
  }
  if (!changed || JSON.stringify(state).length > 1800000) return input;
  state.revision = input.revision + 1;
  return state;
}
