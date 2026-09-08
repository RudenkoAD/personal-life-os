import { env } from 'cloudflare:workers';
import { loadState, saveState, rawDb, type FeedChange } from '@/db/store';
import { textValue, type Source, type CalendarEvent } from '@/lib/domain';
import { identity, body, json, errorResponse } from '@/lib/server';
import { parseCalendar, fetchCalendar, validateFeedUrl } from '@/lib/ical';
import {
  discoverCalendars,
  fetchCalDavEvents,
  validateCalDavUrl,
} from '@/lib/caldav';
import {
  sealCredentials,
  openCredentials,
  type CalendarCredentials,
} from '@/lib/calendar-credentials';

function caldavConfig() {
  const config = env as unknown as {
    CALDAV_ENCRYPTION_KEY?: string;
    CALDAV_ALLOWED_HOSTS?: string;
  };
  if (!config.CALDAV_ENCRYPTION_KEY)
    throw Object.assign(
      new Error('Подключение CalDAV ещё не настроено на сервере.'),
      { status: 503 },
    );
  return {
    key: config.CALDAV_ENCRYPTION_KEY,
    hosts: (config.CALDAV_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  };
}
function credentials(a: Record<string, unknown>): CalendarCredentials {
  const username = textValue(a.username, 'Имя пользователя', 500);
  // Passwords must not be trimmed: whitespace can be significant.
  if (
    typeof a.password !== 'string' ||
    !a.password ||
    a.password.length > 1000 ||
    /[\r\n\0]/.test(a.password)
  )
    throw Object.assign(new Error('Введите пароль приложения CalDAV'), {
      status: 400,
    });
  return { username, password: a.password };
}
export async function POST(request: Request) {
  try {
    const user = await identity(request, true, true);
    const a = await body(request, 1100000);
    if (a.mode === 'caldav' && a.operation === 'discover') {
      const config = caldavConfig();
      return json({
        calendars: await discoverCalendars(
          { url: textValue(a.url, 'Адрес CalDAV', 4000), ...credentials(a) },
          config.hosts,
        ),
      });
    }
    const state = await loadState(user.owner);
    if (a.revision !== state.revision)
      return json({ error: 'Данные изменились. Обновите и повторите.' }, 409);
    let source: Source, events: CalendarEvent[], change: FeedChange | undefined;
    if (a.sourceId) {
      source = state.sources.find((s) => s.id === a.sourceId)!;
      if (!source) return json({ error: 'Календарь не найден' }, 404);
      if (source.kind === 'caldav') {
        const config = caldavConfig();
        const connection = await rawDb()
          .prepare(
            'SELECT url, credentials FROM caldav_connections WHERE id = ? AND owner_id = ?',
          )
          .bind(source.id, user.owner)
          .first<{ url: string; credentials: string }>();
        if (!connection)
          return json({ error: 'Подключите календарь CalDAV заново' }, 400);
        const login = await openCredentials(
          connection.credentials,
          config.key,
          user.owner,
          source.id,
        );
        events = await fetchCalDavEvents(
          { url: connection.url, ...login },
          source.id,
          config.hosts,
        );
      } else {
        const feed = await rawDb()
          .prepare('SELECT url FROM feeds WHERE id = ? AND owner_id = ?')
          .bind(source.id, user.owner)
          .first<{ url: string }>();
        if (!feed)
          return json({ error: 'Для файла загрузите новую версию ICS' }, 400);
        events = parseCalendar(await fetchCalendar(feed.url), source.id);
      }
    } else {
      if (state.sources.length >= 20)
        return json({ error: 'Максимум 20 календарей' }, 400);
      source = {
        id: crypto.randomUUID(),
        title: textValue(a.title, 'Название календаря', 80),
        color: ['#6677dd', '#3e9a82', '#c46c92', '#cf8841'][
          state.sources.length % 4
        ],
        enabled: true,
        kind: a.mode === 'caldav' ? 'caldav' : a.url ? 'feed' : 'file',
        tags: [],
        lastSynced: '',
      };
      if (source.kind === 'caldav') {
        const config = caldavConfig(),
          login = credentials(a);
        const url = validateCalDavUrl(
          textValue(a.url, 'Адрес календаря', 4000),
          config.hosts,
        );
        events = await fetchCalDavEvents(
          { url, ...login },
          source.id,
          config.hosts,
        );
        change = {
          kind: 'putCalDav',
          id: source.id,
          url,
          credentials: await sealCredentials(
            login,
            config.key,
            user.owner,
            source.id,
          ),
        };
      } else if (source.kind === 'feed') {
        const url = validateFeedUrl(textValue(a.url, 'Ссылка', 4000));
        events = parseCalendar(await fetchCalendar(url), source.id);
        change = { kind: 'put', id: source.id, url };
      } else
        events = parseCalendar(textValue(a.ics, 'ICS', 1000000), source.id);
    }
    if (a.tags !== undefined) {
      if (
        !Array.isArray(a.tags) ||
        a.tags.length > 20 ||
        a.tags.some((t: unknown) => !state.tags.some((x) => x.id === t))
      )
        return json({ error: 'Неизвестная сфера календаря' }, 400);
      source.tags = [...new Set(a.tags)] as string[];
    }
    const old = new Map(
      state.events
        .filter((x) => x.sourceId === source.id)
        .map((x) => [x.id, x]),
    );
    events.forEach((e) => (e.tags = old.get(e.id)?.tags ?? source.tags ?? []));
    state.events = [
      ...state.events.filter((x) => x.sourceId !== source.id),
      ...events,
    ];
    source.lastSynced = new Date().toISOString();
    delete source.error;
    if (!a.sourceId) state.sources.push(source);
    state.revision++;
    await saveState(user.owner, state.revision - 1, state, change);
    return json(state);
  } catch (e) {
    return errorResponse(e);
  }
}
