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
function birthdayValue(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Некорректный день рождения');
  const name = (value as Record<string, unknown>).name;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 180)
    throw new Error('Имя: от 1 до 180 символов');
  return { name: name.trim() };
}
function birthdayInvariant(
  fields: EventFields,
  repeat: ReturnType<typeof validateRepeat>,
) {
  if (
    !fields.allDay ||
    fields.startTime !== '00:00' ||
    fields.durationMinutes !== 1440 ||
    repeat.frequency !== 'yearly' ||
    repeat.interval !== 1 ||
    repeat.until !== undefined ||
    repeat.count !== undefined
  )
    throw new Error(
      'День рождения должен быть ежегодным событием на весь день',
    );
}
function birthdayCatchUp(startDate: string, now: Date) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const year = Number(today.slice(0, 4));
  const date = (y: number) =>
    startDate.slice(5, 7) === '02' &&
    startDate.slice(8, 10) === '29' &&
    new Date(Date.UTC(y, 1, 29)).getUTCDate() !== 29
      ? `${y}-02-28`
      : `${y}-${startDate.slice(5)}`;
  return date(year) >= today ? date(year) : date(year + 1);
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
  now = new Date(),
) {
  const tags = state.tags.map((tag) => tag.id);
  if (action.type === 'event.create') {
    const birthday =
      action.birthday === undefined
        ? undefined
        : birthdayValue(action.birthday);
    const birthdayFields = birthday
      ? {
          allDay: true,
          startTime: '00:00',
          durationMinutes: 1440,
          title: `День рождения ${birthday.name}`,
        }
      : {};
    const value = validateEventFields(
      {
        notes: '',
        location: '',
        tags: [],
        allDay: false,
        startTime: '09:00',
        durationMinutes: action.allDay === true ? 1440 : 60,
        ...patchFields(action),
        ...birthdayFields,
      },
      tags,
    );
    const repeat = validateRepeat(
      birthday
        ? { frequency: 'yearly', interval: 1 }
        : (action.repeat ?? { frequency: 'none', interval: 1 }),
      value.startDate,
    );
    if (birthday) birthdayInvariant(value, repeat);
    const id = makeId();
    state.calendarSeries.push({
      ...value,
      repeat,
      id,
      exceptions: {},
      ...(birthday ? { birthday } : {}),
    });
    if (birthday) {
      state.eventTaskRules ??= {};
      const local = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now);
      const y = Number(local.slice(0, 4));
      const make = (year: number) => {
        const month = value.startDate.slice(5, 7),
          day = value.startDate.slice(8, 10);
        if (
          month === '02' &&
          day === '29' &&
          new Date(Date.UTC(year, 1, 29)).getUTCDate() !== 29
        )
          return `${year}-02-28`;
        return `${year}-${month}-${day}`;
      };
      const upcoming = make(y) >= local ? make(y) : make(y + 1);
      state.eventTaskRules[`series:${id}`] = [
        {
          id: 'birthday-gift',
          title: `Купить подарок для «${birthday.name}»`,
          notes: '',
          minutesBefore: 10080,
          createdAt: now.toISOString(),
          catchUpOccurrence: upcoming,
        },
      ];
    }
    return `Создано событие: ${value.title}`;
  }
  const series = state.calendarSeries.find((event) => event.id === action.id);
  if (!series) throw new Error('Событие не найдено');
  if (action.type === 'event.delete') {
    state.calendarSeries = state.calendarSeries.filter(
      (event) => event.id !== series.id,
    );
    delete state.eventTaskRules?.[`series:${series.id}`];
    return `Удалена серия: ${series.title}`;
  }
  if (action.type === 'event.update') {
    const previousBirthday = series.birthday;
    const birthdayRequested = Object.hasOwn(action, 'birthday');
    const convertingToBirthday = birthdayRequested && action.birthday !== null;
    if (
      convertingToBirthday &&
      !previousBirthday &&
      series.exceptions &&
      Object.keys(series.exceptions).length
    )
      throw new Error(
        'Нельзя сделать серией дня рождения событие с изменёнными повторами',
      );
    const birthday = convertingToBirthday
      ? birthdayValue(action.birthday)
      : action.birthday === null
        ? undefined
        : series.birthday;
    const value = validateEventFields(
      {
        ...series,
        ...patchFields(action),
        ...(birthday
          ? {
              allDay: true,
              startTime: '00:00',
              durationMinutes: 1440,
              title: `День рождения ${birthday.name}`,
            }
          : {}),
      },
      tags,
    );
    const repeat = validateRepeat(
      birthday
        ? { frequency: 'yearly', interval: 1 }
        : (action.repeat ?? series.repeat),
      value.startDate,
    );
    if (birthday) birthdayInvariant(value, repeat);
    const next = { ...series, ...value, repeat };
    for (const [date, exception] of Object.entries(series.exceptions)) {
      if (!exception.cancelled && isOccurrenceDate(next, date))
        validateEventFields({ ...next, startDate: date, ...exception }, tags);
    }
    Object.assign(series, value, { repeat });
    if (birthday) series.birthday = birthday;
    else delete series.birthday;
    if (birthday) {
      state.eventTaskRules ??= {};
      const key = `series:${series.id}`,
        rules = state.eventTaskRules[key] ?? [];
      const oldName = previousBirthday?.name;
      const gift = rules.find((r) => r.id === 'birthday-gift');
      if (gift && oldName && gift.title === `Купить подарок для «${oldName}»`)
        gift.title = `Купить подарок для «${birthday.name}»`;
      if (
        convertingToBirthday &&
        !previousBirthday &&
        !rules.some((r) => r.id === 'birthday-gift')
      )
        state.eventTaskRules[key] = [
          {
            id: 'birthday-gift',
            title: `Купить подарок для «${birthday.name}»`,
            notes: '',
            minutesBefore: 10080,
            createdAt: now.toISOString(),
            catchUpOccurrence: birthdayCatchUp(value.startDate, now),
          },
          ...rules,
        ];
    }
    if (birthdayRequested && action.birthday === null)
      delete series.birthdayGiftYears;
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
  if (
    series.birthday &&
    action.type === 'event.override' &&
    action.cancelled !== true
  ) {
    const patch = action.patch;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch))
      throw new Error('Укажите изменения события');
    const keys = Object.keys(patch as Record<string, unknown>);
    if (keys.some((key) => !['notes', 'location'].includes(key)))
      throw new Error('Для дня рождения можно менять только заметки и место');
  }
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
