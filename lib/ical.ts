import ICAL from 'ical.js';
import { DomainError, type CalendarEvent } from './domain.ts';
const DAY = 86400000;
function instant(t: ICAL.Time, tz?: string): string {
  if (t.isDate) return `${t.toString()}T00:00:00+03:00`;
  if (t.zone && t.zone.tzid !== 'floating') return t.toJSDate().toISOString();
  const zone = tz ?? 'Europe/Moscow';
  let value = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  const desired = value;
  for (let i = 0; i < 3; i++) {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(value);
    const parts = Object.fromEntries(p.map((p) => [p.type, p.value]));
    const observed = Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      +parts.hour,
      +parts.minute,
      +parts.second,
    );
    value += desired - observed;
  }
  return new Date(value).toISOString();
}
export function parseCalendar(
  input: string,
  sourceId: string,
  now = new Date(),
): CalendarEvent[] {
  try {
    if (
      input.length > 1000000 ||
      !input.includes('BEGIN:VCALENDAR') ||
      !input.trimEnd().endsWith('END:VCALENDAR')
    )
      throw new Error('invalid calendar');
    const root = new ICAL.Component(ICAL.parse(input));
    const components = root.getAllSubcomponents('vevent');
    if (components.length > 3000) throw new Error('too many events');
    const from = now.getTime() - 31 * DAY,
      to = now.getTime() + 366 * DAY;
    const result = new Map<string, CalendarEvent>();
    let iterations = 0;
    const emit = (
      event: ICAL.Event,
      start: ICAL.Time,
      end: ICAL.Time,
      recurrence: string,
    ) => {
      if (event.component.getFirstPropertyValue('status') === 'CANCELLED')
        return;
      const tz = event.component
        .getFirstProperty('dtstart')
        ?.getParameter('tzid') as string | undefined;
      const startISO = instant(start, tz),
        endISO = instant(end, tz);
      if (
        !Number.isFinite(Date.parse(startISO)) ||
        !Number.isFinite(Date.parse(endISO)) ||
        Date.parse(endISO) <= Date.parse(startISO)
      )
        throw new Error('invalid dates');
      if (Date.parse(endISO) < from || Date.parse(startISO) > to) return;
      const uid = event.uid;
      if (!uid) throw new Error('missing UID');
      const eventId = `${sourceId}:${uid}:${recurrence}`;
      result.set(eventId, {
        id: eventId,
        sourceId,
        uid,
        title: (event.summary || 'Без названия').slice(0, 300),
        start: startISO,
        end: endISO,
        allDay: start.isDate,
        tags: [],
        location: (event.location || '').slice(0, 300),
      });
      if (result.size > 2000) throw new Error('too many occurrences');
    };
    for (const component of components) {
      const event = new ICAL.Event(component);
      if (event.isRecurrenceException()) continue;
      if (!event.uid || !component.getFirstProperty('dtstart'))
        throw new Error('missing fields');
      if (event.isRecurring()) {
        const types = event.getRecurrenceTypes();
        if (types.SECONDLY || types.MINUTELY || types.HOURLY)
          throw new Error('high frequency unsupported');
        const iterator = event.iterator();
        let next: ICAL.Time | null;
        while ((next = iterator.next())) {
          if (++iterations > 20000) throw new Error('too many iterations');
          if (
            Date.parse(
              instant(
                next,
                component.getFirstProperty('dtstart')?.getParameter('tzid') as
                  | string
                  | undefined,
              ),
            ) >
            to + 7 * DAY
          )
            break;
          const details = event.getOccurrenceDetails(next);
          emit(
            details.item,
            details.startDate,
            details.endDate,
            next.toString(),
          );
        }
      } else emit(event, event.startDate, event.endDate, 'single');
    }
    return [...result.values()];
  } catch {
    throw new DomainError(
      'Не удалось прочитать календарь. Нужен полный ICS с UID, корректными датами и повторениями не чаще раза в день (до 2 000 событий). Старые события сохранены.',
    );
  }
}
export const FEED_HOSTS = [
  'calendar.google.com',
  'calendar.yandex.ru',
  'calendar.yandex.com',
  'outlook.office365.com',
  'outlook.live.com',
  'lk.dataschool.yandex.ru',
];
export function validateFeedUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.replace(/^webcal:/, 'https:'));
  } catch {
    throw new DomainError('Некорректная ссылка ICS');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !FEED_HOSTS.includes(url.hostname)
  )
    throw new DomainError(
      'Для подписки поддерживаются HTTPS-ссылки Google, Яндекс, Outlook и DataSchool. Другие календари можно импортировать файлом ICS.',
    );
  return url.href;
}
export async function fetchCalendar(url: string) {
  const response = await fetch(validateFeedUrl(url), {
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: { Accept: 'text/calendar' },
  });
  if (!response.ok)
    throw new DomainError(
      'Источник не отдал календарь. Проверьте ссылку и права доступа.',
    );
  const reader = response.body?.getReader();
  if (!reader) throw new DomainError('Пустой ответ календаря');
  const decoder = new TextDecoder();
  let result = '';
  let bytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 1000000) {
      await reader.cancel();
      throw new DomainError('Размер календаря больше 1 МБ');
    }
    result += decoder.decode(value, { stream: true });
  }
  return result + decoder.decode();
}
