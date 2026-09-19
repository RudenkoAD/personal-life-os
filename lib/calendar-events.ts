import type { CalendarEvent } from './domain.ts';

export type EventRepeat = {
  frequency: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  weekdays?: number[];
  monthlyMode?: 'date' | 'weekday';
  until?: string;
  count?: number;
};
export type EventFields = {
  title: string;
  notes: string;
  location: string;
  tags: string[];
  allDay: boolean;
  startDate: string;
  startTime: string;
  durationMinutes: number;
};
export type Birthday = { name: string };
export type EventSeries = EventFields & {
  id: string;
  repeat: EventRepeat;
  exceptions: Record<string, Partial<EventFields> & { cancelled?: boolean }>;
  birthday?: Birthday;
  /** Server-owned idempotency ledger for generated gift tasks. */
  birthdayGiftYears?: number[];
};
const DAY = 86400000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
function dateNumber(value: string) {
  const number = Date.parse(`${value}T00:00:00Z`);
  if (
    !DATE.test(value) ||
    !Number.isFinite(number) ||
    new Date(number).toISOString().slice(0, 10) !== value
  )
    throw new Error('Укажите корректную дату');
  return number;
}
function validateDate(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value < '1900-01-01' || value > '2199-12-31')
    throw new Error('Дата должна быть между 1900 и 2199 годом');
  dateNumber(value);
}
export function dateAdd(value: string, days: number) {
  if (!Number.isInteger(days)) throw new Error('Укажите корректное число дней');
  return new Date(dateNumber(value) + days * DAY).toISOString().slice(0, 10);
}
const weekday = (date: string) => new Date(dateNumber(date)).getUTCDay();
const monthDays = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
const monthDate = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export function validateEventFields(
  value: unknown,
  validTags: string[] = [],
): EventFields {
  if (!object(value)) throw new Error('Укажите поля события');
  if (
    typeof value.title !== 'string' ||
    !value.title.trim() ||
    value.title.trim().length > 200
  )
    throw new Error('Название: от 1 до 200 символов');
  if (typeof value.notes !== 'string' || value.notes.length > 8000)
    throw new Error('Заметки: до 8000 символов');
  if (typeof value.location !== 'string' || value.location.length > 300)
    throw new Error('Место: до 300 символов');
  if (
    !Array.isArray(value.tags) ||
    value.tags.length > 100 ||
    value.tags.some(
      (tag) => typeof tag !== 'string' || !validTags.includes(tag),
    )
  )
    throw new Error('Неизвестная сфера жизни');
  if (typeof value.allDay !== 'boolean')
    throw new Error('Укажите, длится ли событие весь день');
  validateDate(value.startDate);
  if (typeof value.startTime !== 'string' || !TIME.test(value.startTime))
    throw new Error('Укажите время в формате ЧЧ:ММ');
  const duration = value.durationMinutes;
  if (
    typeof duration !== 'number' ||
    !Number.isInteger(duration) ||
    duration > 10080 ||
    (value.allDay ? duration < 1440 || duration % 1440 !== 0 : duration < 1)
  )
    throw new Error(
      value.allDay
        ? 'Длительность: от 1 до 7 целых дней'
        : 'Длительность: от 1 минуты до 7 дней',
    );
  return {
    title: value.title.trim(),
    notes: value.notes,
    location: value.location,
    tags: [...new Set(value.tags as string[])],
    allDay: value.allDay,
    startDate: value.startDate,
    startTime: value.allDay ? '00:00' : value.startTime,
    durationMinutes: duration,
  };
}
export function validateRepeat(value: unknown, startDate: string): EventRepeat {
  validateDate(startDate);
  if (
    !object(value) ||
    !['none', 'daily', 'weekly', 'monthly', 'yearly'].includes(
      String(value.frequency),
    )
  )
    throw new Error('Укажите правило повторения');
  if (
    typeof value.interval !== 'number' ||
    !Number.isInteger(value.interval) ||
    value.interval < 1 ||
    value.interval > 366
  )
    throw new Error('Интервал повторения: от 1 до 366');
  if (value.frequency === 'none') return { frequency: 'none', interval: 1 };
  const repeat: EventRepeat = {
    frequency: value.frequency as EventRepeat['frequency'],
    interval: value.interval,
  };
  if (value.count !== undefined && value.until !== undefined)
    throw new Error('Выберите дату окончания или число повторов');
  if (value.count !== undefined) {
    if (
      typeof value.count !== 'number' ||
      !Number.isInteger(value.count) ||
      value.count < 1 ||
      value.count > 10000
    )
      throw new Error('Число событий: от 1 до 10000');
    repeat.count = value.count;
  }
  if (value.until !== undefined) {
    validateDate(value.until);
    if (value.until < startDate)
      throw new Error('Окончание повторов раньше начала');
    repeat.until = value.until;
  }
  if (value.frequency === 'weekly') {
    const days = value.weekdays ?? [weekday(startDate)];
    if (
      !Array.isArray(days) ||
      !days.length ||
      days.length > 7 ||
      days.some(
        (day) =>
          typeof day !== 'number' ||
          !Number.isInteger(day) ||
          day < 0 ||
          day > 6,
      )
    )
      throw new Error('Выберите дни недели');
    repeat.weekdays = [...new Set(days as number[])].sort(
      (a, b) => ((a + 6) % 7) - ((b + 6) % 7),
    );
  }
  if (value.frequency === 'monthly') {
    if (
      value.monthlyMode !== undefined &&
      value.monthlyMode !== 'date' &&
      value.monthlyMode !== 'weekday'
    )
      throw new Error('Укажите правило месяца');
    repeat.monthlyMode = value.monthlyMode ?? 'date';
  }
  return repeat;
}

// Every interval is anchored to the series start, independently of the visible window.
function candidateDates(
  series: EventSeries,
  from: string,
  to: string,
): string[] {
  const { repeat: rule, startDate: start } = series;
  const result: string[] = [];
  const horizon = rule.until && rule.until < to ? dateAdd(rule.until, 1) : to;
  if (horizon <= start || horizon <= from) return result;
  const emit = (date: string) => {
    if (date >= from && date >= start && date < horizon && date <= '2199-12-31')
      result.push(date);
  };
  if (rule.frequency === 'none') {
    emit(start);
    return result;
  }
  if (rule.frequency === 'daily') {
    const first = Math.max(
      0,
      Math.floor((dateNumber(from) - dateNumber(start)) / DAY / rule.interval),
    );
    for (let index = first; !rule.count || index < rule.count; index++) {
      const date = dateAdd(start, index * rule.interval);
      if (date >= horizon) break;
      emit(date);
    }
  } else if (rule.frequency === 'weekly') {
    const days = [...(rule.weekdays ?? [weekday(start)])].sort(
      (a, b) => ((a + 6) % 7) - ((b + 6) % 7),
    );
    const anchor = dateAdd(start, -((weekday(start) + 6) % 7));
    const first = rule.count
      ? 0
      : Math.max(
          0,
          Math.floor(
            (dateNumber(from) - dateNumber(anchor)) / DAY / (7 * rule.interval),
          ),
        );
    let count = 0;
    for (let index = first; ; index++) {
      const monday = dateAdd(anchor, index * 7 * rule.interval);
      if (monday >= horizon) break;
      for (const day of days) {
        const date = dateAdd(monday, (day + 6) % 7);
        if (date < start) continue;
        if (rule.count && ++count > rule.count) return result;
        emit(date);
      }
    }
  } else {
    // At most 3600 months in the supported range. Counting from the anchor also
    // counts only real dates: February 29 and day 31 skip missing dates.
    const year = Number(start.slice(0, 4)),
      month = Number(start.slice(5, 7)),
      day = Number(start.slice(8));
    const anchorWeekday = weekday(start),
      lastWeekday = day + 7 > monthDays(year, month);
    let count = 0;
    for (let index = 0; ; index++) {
      const offset =
        index * rule.interval * (rule.frequency === 'yearly' ? 12 : 1);
      const y = year + Math.floor((month - 1 + offset) / 12),
        m = ((month - 1 + offset) % 12) + 1;
      if (y > 2199 || monthDate(y, m, 1) >= horizon) break;
      const days = monthDays(y, m);
      let d = day;
      if (rule.frequency === 'monthly' && rule.monthlyMode === 'weekday') {
        const firstMatch =
          1 + ((anchorWeekday - weekday(monthDate(y, m, 1)) + 7) % 7);
        d = lastWeekday
          ? firstMatch + Math.floor((days - firstMatch) / 7) * 7
          : firstMatch + Math.floor((day - 1) / 7) * 7;
      }
      if (d > days) {
        if (
          series.birthday &&
          rule.frequency === 'yearly' &&
          month === 2 &&
          day === 29 &&
          m === 2 &&
          d === 29
        )
          d = 28;
        else continue;
      }
      const date = monthDate(y, m, d);
      if (rule.count && ++count > rule.count) break;
      emit(date);
    }
  }
  return result;
}
export function isOccurrenceDate(series: EventSeries, date: string) {
  try {
    validateDate(date);
    return candidateDates(series, date, dateAdd(date, 1)).includes(date);
  } catch {
    return false;
  }
}
function makeOccurrence(
  series: EventSeries,
  date: string,
): CalendarEvent | null {
  const exception = series.exceptions[date];
  if (exception?.cancelled) return null;
  const fields = { ...series, startDate: date, ...exception };
  const start = `${fields.startDate}T${fields.allDay ? '00:00' : fields.startTime}:00+03:00`;
  return {
    id: `local:${series.id}:${date}`,
    sourceId: 'local',
    uid: series.id,
    seriesId: series.id,
    occurrenceDate: date,
    title: fields.title,
    notes: fields.notes,
    location: fields.location,
    tags: fields.tags,
    allDay: fields.allDay,
    start,
    end: new Date(
      Date.parse(start) + fields.durationMinutes * 60000,
    ).toISOString(),
  };
}
export function eventOnDate(
  series: EventSeries,
  date: string,
): CalendarEvent | null {
  return isOccurrenceDate(series, date) ? makeOccurrence(series, date) : null;
}
export function expandEventSeries(
  series: EventSeries[],
  from: string,
  to: string,
): CalendarEvent[] {
  const fromNumber = dateNumber(from),
    toNumber = dateNumber(to);
  if (
    from < '1900-01-01' ||
    to > '2200-01-01' ||
    toNumber <= fromNumber ||
    toNumber - fromNumber > 366 * DAY
  )
    throw new Error('Диапазон календаря: от 1 до 366 дней');
  const fromInstant = fromNumber - 10800000,
    toInstant = toNumber - 10800000;
  const output: CalendarEvent[] = [];
  const append = (event: CalendarEvent | null) => {
    if (
      event &&
      Date.parse(event.start) < toInstant &&
      Date.parse(event.end) > fromInstant
    ) {
      output.push(event);
      if (output.length > 5000)
        throw new Error(
          'В этом периоде больше 5000 событий. Сократите период или число серий.',
        );
    }
  };
  for (const item of series) {
    const dates = new Set(candidateDates(item, dateAdd(from, -7), to));
    for (const date of dates) append(makeOccurrence(item, date));
    // An exception can move in from any original date; use actual overlap.
    for (const date of Object.keys(item.exceptions))
      if (!dates.has(date)) append(eventOnDate(item, date));
  }
  return output.sort(
    (a, b) =>
      Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id),
  );
}
export function recurrenceLabel(series: EventSeries) {
  const { frequency, interval, weekdays, monthlyMode } = series.repeat;
  const labels = {
    none: 'Однократно',
    daily: 'Каждый день',
    weekly: 'Каждую неделю',
    monthly: 'Каждый месяц',
    yearly: 'Каждый год',
  };
  const units = { daily: 'дн.', weekly: 'нед.', monthly: 'мес.', yearly: 'г.' };
  const base =
    frequency === 'none' || interval === 1
      ? labels[frequency]
      : `Каждые ${interval} ${units[frequency]}`;
  if (frequency === 'weekly')
    return `${base} · ${(weekdays ?? [weekday(series.startDate)]).map((day) => ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][day]).join(', ')}`;
  if (frequency === 'monthly' && monthlyMode === 'weekday') {
    const date = Number(series.startDate.slice(8));
    const last =
      date + 7 >
      monthDays(
        Number(series.startDate.slice(0, 4)),
        Number(series.startDate.slice(5, 7)),
      );
    return `${base} · ${last ? 'последний' : Math.ceil(date / 7) + '-й'} ${['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][weekday(series.startDate)]}`;
  }
  return base;
}
