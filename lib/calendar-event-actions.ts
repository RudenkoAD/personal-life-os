import type { Action, LifeState } from './domain.ts';
import {
  isOccurrenceDate,
  validateEventFields,
  validateRepeat,
  type EventFields,
  type EventSeries,
} from './calendar-events.ts';

const fields = [
  'title',
  'notes',
  'location',
  'tags',
  'allDay',
  'startDate',
  'startTime',
  'durationMinutes',
] as const;
function patchFields(value: Record<string, unknown>) {
  return Object.fromEntries(
    fields
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, value[key]]),
  );
}
export function occurrenceFields(
  series: EventSeries,
  date: string,
): EventFields {
  return { ...series, startDate: date, ...series.exceptions[date] };
}

export function applyCalendarEventAction(
  state: LifeState,
  action: Action,
  makeId: () => string,
) {
  const tags = state.tags.map((tag) => tag.id);
  if (action.type === 'event.create') {
    const value = validateEventFields(
      {
        notes: '',
        location: '',
        tags: [],
        allDay: false,
        startTime: '09:00',
        durationMinutes: action.allDay === true ? 1440 : 60,
        ...patchFields(action),
      },
      tags,
    );
    const repeat = validateRepeat(
      action.repeat ?? { frequency: 'none', interval: 1 },
      value.startDate,
    );
    state.calendarSeries.push({
      ...value,
      repeat,
      id: makeId(),
      exceptions: {},
    });
    return `Создано событие: ${value.title}`;
  }
  const series = state.calendarSeries.find((event) => event.id === action.id);
  if (!series) throw new Error('Событие не найдено');
  if (action.type === 'event.delete') {
    state.calendarSeries = state.calendarSeries.filter(
      (event) => event.id !== series.id,
    );
    return `Удалена серия: ${series.title}`;
  }
  if (action.type === 'event.update') {
    const value = validateEventFields(
      { ...series, ...patchFields(action) },
      tags,
    );
    const repeat = validateRepeat(
      action.repeat ?? series.repeat,
      value.startDate,
    );
    const next = { ...series, ...value, repeat };
    for (const [date, exception] of Object.entries(series.exceptions)) {
      if (!exception.cancelled && isOccurrenceDate(next, date))
        validateEventFields({ ...next, startDate: date, ...exception }, tags);
    }
    Object.assign(series, value, { repeat });
    return `Изменено событие: ${series.title}`;
  }
  if (
    typeof action.occurrenceDate !== 'string' ||
    (!(
      action.type === 'event.restore' &&
      Object.hasOwn(series.exceptions, action.occurrenceDate)
    ) &&
      !isOccurrenceDate(series, action.occurrenceDate))
  )
    throw new Error('Повтор не найден');
  const date = action.occurrenceDate;
  if (action.type === 'event.restore') {
    delete series.exceptions[date];
    return `Восстановлен повтор: ${series.title}`;
  }
  if (action.cancelled !== undefined && typeof action.cancelled !== 'boolean')
    throw new Error('Некорректная отмена повтора');
  if (action.cancelled === true) {
    series.exceptions[date] = { ...series.exceptions[date], cancelled: true };
  } else {
    if (
      !action.patch ||
      typeof action.patch !== 'object' ||
      Array.isArray(action.patch)
    )
      throw new Error('Укажите изменения события');
    const patch = action.patch as Record<string, unknown>;
    if (
      Object.keys(patch).some(
        (key) => !fields.includes(key as (typeof fields)[number]),
      )
    )
      throw new Error('Настройки серии меняются для всех повторов');
    const value = validateEventFields(
      { ...occurrenceFields(series, date), ...patchFields(patch) },
      tags,
    );
    const previous = series.exceptions[date] ?? {};
    const changed = patchFields(patch);
    // Store only explicit changes so later series edits can still reach inherited fields.
    series.exceptions[date] = {
      ...previous,
      ...Object.fromEntries(
        Object.keys(changed).map((key) => [
          key,
          value[key as keyof EventFields],
        ]),
      ),
      cancelled: false,
    };
    if (patch.allDay === true) series.exceptions[date].startTime = '00:00';
  }
  if (Object.keys(series.exceptions).length > 1000)
    throw new Error('Слишком много изменённых повторов в серии');
  return `${action.cancelled === true ? 'Отменён' : 'Изменён'} повтор: ${series.title}`;
}
