import { DOMParser } from '@xmldom/xmldom';
import type { Element as XmlElement } from '@xmldom/xmldom';
import { DomainError, type CalendarEvent } from './domain.ts';
import { parseCalendar } from './ical.ts';
const DAV = 'DAV:',
  CALDAV = 'urn:ietf:params:xml:ns:caldav',
  MAX = 1_000_000;
const BUILTIN = new Set([
  'caldav.yandex.ru',
  'caldav.yandex.com',
  'caldav-mob.yandex-team.ru',
  'caldav.icloud.com',
  'caldav.fastmail.com',
]);
type Credentials = { url: string; username: string; password: string };
type Calendar = { url: string; title: string };
const fail = (message = 'Источник CalDAV недоступен'): never => {
  throw new DomainError(message);
};
export function validateCalDavUrl(
  input: string,
  extraAllowedHosts: string[] = [],
) {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return fail('Некорректный адрес CalDAV');
  }
  const h = u.hostname.toLowerCase(),
    extra = extraAllowedHosts.map((x) => x.toLowerCase());
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.port ||
    u.search ||
    u.hash ||
    !/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(h) ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/.test(h) ||
    !(
      BUILTIN.has(h) ||
      /^p\d{2}-caldav\.icloud\.com$/.test(h) ||
      extra.includes(h)
    )
  )
    fail('Укажите HTTPS-адрес разрешённого CalDAV-сервера без пароля в ссылке');
  return u.href;
}
function sameOrigin(base: URL, href: string) {
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    return fail('Некорректная ссылка в ответе CalDAV');
  }
  if (
    u.origin !== base.origin ||
    u.username ||
    u.password ||
    u.search ||
    u.hash
  )
    fail('CalDAV вернул ссылку на другой сервер или недопустимый адрес');
  return u;
}
function basic(input: Credentials) {
  if (
    !input.username ||
    !input.password ||
    input.username.length > 500 ||
    input.password.length > 1000 ||
    /[:\x00-\x1f\x7f]/.test(input.username) ||
    /[\x00-\x1f\x7f]/.test(input.password)
  )
    fail('Некорректные учётные данные CalDAV');
  return (
    'Basic ' +
    btoa(
      Array.from(
        new TextEncoder().encode(`${input.username}:${input.password}`),
        (x) => String.fromCharCode(x),
      ).join(''),
    )
  );
}
function children(node: XmlElement, ns: string, name: string) {
  const out: XmlElement[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling)
    if (c.nodeType === 1) {
      const e = c as XmlElement;
      if (e.namespaceURI === ns && e.localName === name) out.push(e);
    }
  return out;
}
const child = (node: XmlElement, ns: string, name: string) =>
  children(node, ns, name)[0];
const statusOk = (node?: XmlElement) =>
  !!node && /^HTTP\/\S+\s+2\d\d(?:\s|$)/.test(node.textContent ?? '');
function properties(response: XmlElement, strict = false) {
  const directStatus = child(response, DAV, 'status');
  if (directStatus && !statusOk(directStatus)) {
    if (strict) fail('CalDAV не смог прочитать часть событий');
    return [];
  }
  const props: XmlElement[] = [];
  for (const part of children(response, DAV, 'propstat')) {
    if (!statusOk(child(part, DAV, 'status'))) {
      if (strict) fail('CalDAV не смог прочитать часть событий');
      continue;
    }
    const prop = child(part, DAV, 'prop');
    if (prop) props.push(prop);
  }
  return props;
}
const property = (props: XmlElement[], ns: string, name: string) =>
  props.flatMap((p) => children(p, ns, name))[0];
function rows(root: XmlElement, base: URL) {
  const list = children(root, DAV, 'response');
  if (list.length > 500) fail('Слишком много ресурсов CalDAV');
  const seen = new Set<string>();
  return list.map((response) => {
    const href = child(response, DAV, 'href')?.textContent?.trim();
    if (!href) return fail('CalDAV не указал адрес ресурса');
    const url = sameOrigin(base, href);
    if (seen.has(url.href)) fail('CalDAV вернул дублирующиеся ресурсы');
    seen.add(url.href);
    return { response, url };
  });
}
function parseXml(text: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail('Недопустимый XML CalDAV');
  try {
    const root = new DOMParser({
      onError() {
        throw new Error();
      },
    }).parseFromString(text, 'application/xml').documentElement;
    if (!root || root.namespaceURI !== DAV || root.localName !== 'multistatus')
      throw new Error();
    // Bound traversal depth before processing properties from an untrusted server.
    const stack: [XmlElement, number][] = [[root, 0]];
    let count = 0;
    while (stack.length) {
      const [element, depth] = stack.pop()!;
      if (depth > 32 || ++count > 30000) throw new Error();
      for (let c = element.firstChild; c; c = c.nextSibling)
        if (c.nodeType === 1) stack.push([c as XmlElement, depth + 1]);
    }
    return root;
  } catch {
    return fail('Источник вернул некорректный XML CalDAV');
  }
}
function client(input: Credentials, extra: string[], fetcher: typeof fetch) {
  const initial = new URL(validateCalDavUrl(input.url, extra)),
    authorization = basic(input);
  let bytes = 0;
  return {
    initial,
    async request(
      url: URL,
      method: 'PROPFIND' | 'REPORT',
      body: string,
      depth: '0' | '1',
    ) {
      let current = sameOrigin(initial, url.href);
      for (let hop = 0; hop <= 2; hop++) {
        let r: Response;
        try {
          r = await fetcher(current.href, {
            method,
            body,
            redirect: 'manual',
            signal: AbortSignal.timeout(15000),
            headers: {
              Authorization: authorization,
              Depth: depth,
              Accept: 'application/xml, text/xml',
              'Content-Type': 'application/xml; charset=utf-8',
            },
          });
        } catch {
          return fail('Не удалось связаться с CalDAV-сервером');
        }
        if (r.status >= 300 && r.status < 400) {
          await r.body?.cancel();
          const location = r.headers.get('location');
          if (!location || hop === 2)
            fail('Слишком много перенаправлений CalDAV');
          current = sameOrigin(current, location!);
          continue;
        }
        if (r.status !== 207) {
          await r.body?.cancel();
          throw Object.assign(
            new DomainError(
              r.status === 401 || r.status === 403
                ? 'CalDAV отклонил вход. Проверьте имя пользователя и пароль приложения.'
                : 'CalDAV-сервер не поддерживает запрос по этому адресу.',
            ),
            { upstreamStatus: r.status },
          );
        }
        const reader = r.body?.getReader();
        if (!reader) return fail('Пустой ответ CalDAV');
        const decoder = new TextDecoder();
        let text = '';
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > MAX) {
              await reader.cancel();
              fail('Ответ CalDAV больше 1 МБ');
            }
            text += decoder.decode(value, { stream: true });
          }
        } catch (error) {
          if (error instanceof DomainError) throw error;
          return fail('Ответ CalDAV не получен полностью');
        }
        text += decoder.decode();
        return { root: parseXml(text), url: current };
      }
      return fail();
    },
  };
}
const propfind = (props: string) =>
  `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="${CALDAV}"><d:prop>${props}</d:prop></d:propfind>`;
const discovery = propfind(
  '<d:displayname/><d:resourcetype/><d:current-user-principal/><c:calendar-home-set/>',
);
const collectionTitle = (props: XmlElement[]) =>
  property(props, DAV, 'displayname')?.textContent?.trim().slice(0, 80) ||
  'Календарь';
export async function discoverCalendars(
  input: Credentials,
  extraAllowedHosts: string[] = [],
  fetcher: typeof fetch = fetch,
): Promise<Calendar[]> {
  const c = client(input, extraAllowedHosts, fetcher);
  let first: Awaited<ReturnType<typeof c.request>>;
  try {
    first = await c.request(c.initial, 'PROPFIND', discovery, '0');
  } catch (e) {
    if (
      c.initial.pathname !== '/' ||
      ![404, 405].includes(
        (e as { upstreamStatus?: number }).upstreamStatus ?? 0,
      )
    )
      throw e;
    first = await c.request(
      new URL('/.well-known/caldav', c.initial),
      'PROPFIND',
      discovery,
      '0',
    );
  }
  const own = rows(first.root, first.url).find(
    (r) =>
      r.url.pathname.replace(/\/$/, '') ===
      first.url.pathname.replace(/\/$/, ''),
  );
  if (!own) return fail('CalDAV не сообщил свойства сервера');
  let props = properties(own.response);
  const resource = property(props, DAV, 'resourcetype');
  if (resource && child(resource, CALDAV, 'calendar'))
    return [{ url: own.url.href, title: collectionTitle(props) }];
  let home = property(props, CALDAV, 'calendar-home-set'),
    base = first.url;
  if (!home) {
    const principal = property(props, DAV, 'current-user-principal');
    const href =
      principal && child(principal, DAV, 'href')?.textContent?.trim();
    if (!href)
      return fail('CalDAV не сообщил пользователя или каталог календарей');
    const result = await c.request(
      sameOrigin(base, href),
      'PROPFIND',
      discovery,
      '0',
    );
    const row = rows(result.root, result.url).find(
      (r) =>
        r.url.pathname.replace(/\/$/, '') ===
        result.url.pathname.replace(/\/$/, ''),
    );
    if (!row) return fail('CalDAV не сообщил свойства пользователя');
    props = properties(row.response);
    home = property(props, CALDAV, 'calendar-home-set');
    base = result.url;
  }
  const homeHref = home && child(home, DAV, 'href')?.textContent?.trim();
  if (!homeHref) return fail('CalDAV не сообщил каталог календарей');
  const result = await c.request(
    sameOrigin(base, homeHref),
    'PROPFIND',
    propfind('<d:displayname/><d:resourcetype/>'),
    '1',
  );
  const calendars: Calendar[] = [];
  for (const row of rows(result.root, result.url)) {
    const props = properties(row.response),
      type = property(props, DAV, 'resourcetype');
    if (type && child(type, CALDAV, 'calendar'))
      calendars.push({ url: row.url.href, title: collectionTitle(props) });
    if (calendars.length > 20)
      fail('Слишком много календарей. Укажите адрес конкретного календаря.');
  }
  return calendars;
}
const stamp = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
export async function fetchCalDavEvents(
  input: Credentials,
  sourceId: string,
  extraAllowedHosts: string[] = [],
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<CalendarEvent[]> {
  const c = client(input, extraAllowedHosts, fetcher);
  const start = stamp(new Date(now.getTime() - 31 * 86400000)),
    end = stamp(new Date(now.getTime() + 366 * 86400000));
  const body = `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="${CALDAV}"><d:prop><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${start}" end="${end}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const result = await c.request(c.initial, 'REPORT', body, '1'),
    events: CalendarEvent[] = [],
    ids = new Set<string>();
  let bytes = 0;
  for (const row of rows(result.root, result.url)) {
    const data = property(
      properties(row.response, true),
      CALDAV,
      'calendar-data',
    );
    if (!data) fail('CalDAV не вернул данные части событий');
    const ics = data.textContent ?? '';
    bytes += new TextEncoder().encode(ics).length;
    if (bytes > MAX) fail('События CalDAV больше 1 МБ');
    try {
      for (const event of parseCalendar(ics, sourceId, now)) {
        if (ids.has(event.id)) fail('CalDAV вернул дублирующиеся события');
        ids.add(event.id);
        events.push(event);
        if (events.length > 2000) fail('Слишком много событий CalDAV');
      }
    } catch {
      fail('Не удалось полностью прочитать события CalDAV');
    }
  }
  return events;
}
