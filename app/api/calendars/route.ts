import { loadState, saveState, rawDb } from '@/db/store';
import { textValue, type Source } from '@/lib/domain';
import { identity, body, json, errorResponse } from '@/lib/server';
import { parseCalendar, fetchCalendar, validateFeedUrl } from '@/lib/ical';
export async function POST(request: Request) {
  try {
    const user = await identity(request, true, true);
    const a = await body(request, 1100000);
    const state = await loadState(user.owner);
    if (a.revision !== state.revision)
      return json({ error: 'Данные изменились. Обновите и повторите.' }, 409);
    let source: Source, ics: string, url: string | undefined;
    if (a.sourceId) {
      source = state.sources.find((s) => s.id === a.sourceId)!;
      if (!source) return json({ error: 'Календарь не найден' }, 404);
      const feed = await rawDb()
        .prepare('SELECT url FROM feeds WHERE id = ? AND owner_id = ?')
        .bind(source.id, user.owner)
        .first<{ url: string }>();
      if (!feed)
        return json({ error: 'Для файла загрузите новую версию ICS' }, 400);
      ics = await fetchCalendar(feed.url);
    } else {
      if (state.sources.length >= 20)
        return json({ error: 'Максимум 20 календарей' }, 400);
      const title = textValue(a.title, 'Название календаря', 80);
      source = {
        id: crypto.randomUUID(),
        title,
        color: ['#6677dd', '#3e9a82', '#c46c92', '#cf8841'][
          state.sources.length % 4
        ],
        enabled: true,
        kind: a.url ? 'feed' : 'file',
        tags: [],
        lastSynced: '',
      };
      if (a.url) {
        url = validateFeedUrl(textValue(a.url, 'Ссылка', 4000));
        ics = await fetchCalendar(url);
      } else ics = textValue(a.ics, 'ICS', 1000000);
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
    const events = parseCalendar(ics, source.id);
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
    await saveState(
      user.owner,
      state.revision - 1,
      state,
      url ? { kind: 'put', id: source.id, url } : undefined,
    );
    return json(state);
  } catch (e) {
    return errorResponse(e);
  }
}
