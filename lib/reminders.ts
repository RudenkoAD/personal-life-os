import type { LifeState } from './domain.ts';
import { isOccurrenceDate } from './calendar-events.ts';

export type ReminderTarget = {
  kind: 'series' | 'occurrence' | 'external' | 'card';
  id: string;
  occurrenceDate?: string;
};
export type ReminderSettings = {
  defaultMinutes: number[];
  byTag: Record<string, number[]>;
  overrides: Record<string, number[]>;
};
const MAX = 525600;
const clean = (value: unknown, required = false): number[] => {
  if (value === null && !required) return [];
  if (
    !Array.isArray(value) ||
    value.length > 8 ||
    value.some((x) => !Number.isInteger(x) || x < 0 || x > MAX)
  )
    throw new Error('Некорректные интервалы напоминаний');
  return [...new Set(value as number[])].sort((a, b) => b - a);
};
export function reminderKey(target: ReminderTarget) {
  if (target.kind === 'occurrence')
    return `occurrence:${target.id}:${target.occurrenceDate}`;
  return `${target.kind}:${target.id}`;
}
export function normalizeReminderSettings(state: LifeState) {
  const r = state.reminderSettings ?? {
    defaultMinutes: [],
    byTag: {},
    overrides: {},
  };
  r.byTag ??= {};
  r.overrides ??= {};
  r.defaultMinutes = clean(r.defaultMinutes);
  for (const [tag, value] of Object.entries(r.byTag ?? {}))
    r.byTag[tag] = clean(value);
  for (const [key, value] of Object.entries(r.overrides ?? {}))
    r.overrides[key] = clean(value);
  state.reminderSettings = r;
  return r;
}
function targetExists(state: LifeState, target: ReminderTarget) {
  if (
    !target ||
    !['series', 'occurrence', 'external', 'card'].includes(target.kind) ||
    typeof target.id !== 'string' ||
    !target.id
  )
    throw new Error('Некорректная цель напоминаний');
  if (target.kind === 'series' || target.kind === 'occurrence') {
    const series = state.calendarSeries.find((x) => x.id === target.id);
    if (!series) throw new Error('Серия не найдена');
    if (
      target.kind === 'occurrence' &&
      (typeof target.occurrenceDate !== 'string' ||
        !isOccurrenceDate(series, target.occurrenceDate))
    )
      throw new Error('Повтор не найден');
    return series;
  }
  if (target.kind === 'external') {
    if (!state.events.some((x) => x.id === target.id))
      throw new Error('Событие не найдено');
    return undefined;
  }
  const card = state.cards.find((x) => x.id === target.id);
  if (!card || card.placement !== 'calendar')
    throw new Error('Карточка должна быть запланирована');
  return undefined;
}
export function applyReminderAction(
  state: LifeState,
  action: Record<string, unknown>,
) {
  const settings = normalizeReminderSettings(state);
  if (action.type === 'reminders.defaults') {
    const scopeId = action.scopeId;
    if (scopeId === undefined) {
      settings.defaultMinutes = clean(action.minutes, true);
      return 'Изменены напоминания по умолчанию';
    }
    if (
      typeof scopeId !== 'string' ||
      !state.tags.some((x) => x.id === scopeId)
    )
      throw new Error('Сфера не найдена');
    if (action.minutes === null) delete settings.byTag[scopeId];
    else settings.byTag[scopeId] = clean(action.minutes);
    return 'Изменены напоминания сферы';
  }
  const target = action.target as ReminderTarget;
  targetExists(state, target);
  const key = reminderKey(target);
  if (action.minutes === null) delete settings.overrides[key];
  else settings.overrides[key] = clean(action.minutes);
  if (Object.keys(settings.overrides).length > 2000)
    throw new Error('Слишком много настроек напоминаний');
  return 'Изменены напоминания';
}
export function effectiveReminderMinutes(
  state: LifeState,
  target: ReminderTarget,
): number[] {
  const raw = state.reminderSettings;
  const settings = raw
    ? {
        defaultMinutes: raw.defaultMinutes ?? [],
        byTag: raw.byTag ?? {},
        overrides: raw.overrides ?? {},
      }
    : { defaultMinutes: [], byTag: {}, overrides: {} };
  const key = reminderKey(target);
  if (Object.hasOwn(settings.overrides, key)) return settings.overrides[key];
  const series =
    target.kind === 'series' || target.kind === 'occurrence'
      ? state.calendarSeries.find((x) => x.id === target.id)
      : undefined;
  if (series && Object.hasOwn(settings.overrides, `series:${series.id}`))
    return settings.overrides[`series:${series.id}`];
  if (series?.birthday) return [10080, 4320, 1440, 0];
  const tags = series
    ? [
        ...series.tags,
        ...(target.kind === 'occurrence'
          ? (series.exceptions[target.occurrenceDate ?? '']?.tags ?? [])
          : []),
      ]
    : target.kind === 'card'
      ? (state.cards.find((x) => x.id === target.id)?.tags ?? [])
      : target.kind === 'external'
        ? (() => {
            const e = state.events.find((x) => x.id === target.id);
            const source = e && state.sources.find((s) => s.id === e.sourceId);
            return [...(e?.tags ?? []), ...(source?.tags ?? [])];
          })()
        : [];
  const configured = tags.filter((tag) => Object.hasOwn(settings.byTag, tag));
  if (configured.length)
    return [
      ...new Set(configured.flatMap((tag) => settings.byTag[tag] ?? [])),
    ].sort((a, b) => b - a);
  return settings.defaultMinutes;
}
