import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverCalendars,
  fetchCalDavEvents,
  validateCalDavUrl,
} from '../lib/caldav.ts';

const CALDAV = 'urn:ietf:params:xml:ns:caldav';
const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//fixture//EN\r\nBEGIN:VEVENT\r\nUID:fixture-1\r\nDTSTART:20260908T100000Z\r\nDTEND:20260908T110000Z\r\nSUMMARY:Тест\r\nLOCATION:Room & One\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
const multi = (responses) =>
  `<d:multistatus xmlns:d="DAV:" xmlns:c="${CALDAV}">${responses}</d:multistatus>`;
const response = (href, body, status = 'HTTP/1.1 200 OK') =>
  `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${body}</d:prop><d:status>${status}</d:status></d:propstat></d:response>`;
const calProps = (title = 'Main') =>
  `<d:displayname>${title}</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype>`;
const ok = (body, status = 207, headers = {}) =>
  new Response(body, { status, headers });
const auth = (u, p) =>
  `Basic ${Buffer.from(`${u}:${p}`, 'utf8').toString('base64')}`;

test('validates host policy and rejects unsafe URL forms', () => {
  assert.equal(
    validateCalDavUrl('https://caldav.yandex.com/a'),
    'https://caldav.yandex.com/a',
  );
  assert.equal(
    validateCalDavUrl('https://calendar.example.com/dav', [
      'calendar.example.com',
    ]),
    'https://calendar.example.com/dav',
  );
  for (const value of [
    'http://caldav.yandex.com/a',
    'https://user:pass@caldav.yandex.com/a',
    'https://caldav.yandex.com:444/a',
    'https://127.0.0.1/a',
    'https://foo.local/a',
    'https://evil.example/a?x=1',
  ])
    assert.throws(() => validateCalDavUrl(value, ['evil.example']));
});

test('discovers a direct calendar collection and resolves a relative href', async () => {
  const seen = [];
  const fetcher = async (url, options) => {
    seen.push({ url, options });
    return ok(multi(response('/dav/cal', calProps('Direct'))));
  };
  const result = await discoverCalendars(
    {
      url: 'https://caldav.yandex.com/dav/cal',
      username: 'u',
      password: 'пароль',
    },
    [],
    fetcher,
  );
  assert.deepEqual(result, [
    { url: 'https://caldav.yandex.com/dav/cal', title: 'Direct' },
  ]);
  assert.equal(seen[0].options.headers.Authorization, auth('u', 'пароль'));
  assert.match(seen[0].options.body, /current-user-principal/);
});

test('discovers principal, home and calendars despite optional 404 properties', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/root'))
      return ok(
        multi(
          response(
            '/root',
            '<d:current-user-principal><d:href>/principal</d:href></d:current-user-principal>',
          ),
        ),
      );
    if (url.endsWith('/principal'))
      return ok(
        multi(
          response(
            '/principal',
            '<c:calendar-home-set><d:href>/home</d:href></c:calendar-home-set>',
          ),
        ),
      );
    return ok(
      multi(
        response('/home/main', calProps('Work')) +
          response(
            '/home/other',
            '<d:displayname>Other</d:displayname>',
            'HTTP/1.1 404 Not Found',
          ),
      ),
    );
  };
  const result = await discoverCalendars(
    { url: 'https://caldav.yandex.com/root', username: 'u', password: 'p' },
    [],
    fetcher,
  );
  assert.deepEqual(result, [
    { url: 'https://caldav.yandex.com/home/main', title: 'Work' },
  ]);
  assert.equal(calls.length, 3);
});

test('accepts empty 207 REPORT result', async () => {
  const fetcher = async () => ok(multi(''));
  assert.deepEqual(
    await fetchCalDavEvents(
      {
        url: 'https://caldav.yandex.com/home/main',
        username: 'u',
        password: 'p',
      },
      's',
      [],
      fetcher,
      new Date('2026-09-08T00:00:00Z'),
    ),
    [],
  );
});

test('parses namespaced CDATA calendar-data and sends UTF-8 Basic auth', async () => {
  let request;
  const fetcher = async (url, options) => {
    request = { url, options };
    return ok(
      multi(
        response(
          '/home/main/e1',
          `<c:calendar-data><![CDATA[${ics}]]></c:calendar-data>`,
        ),
      ),
    );
  };
  const events = await fetchCalDavEvents(
    {
      url: 'https://caldav.yandex.com/home/main',
      username: 'юзер',
      password: 'пароль',
    },
    's',
    [],
    fetcher,
    new Date('2026-09-08T00:00:00Z'),
  );
  assert.equal(events[0].title, 'Тест');
  assert.equal(request.options.headers.Authorization, auth('юзер', 'пароль'));
  assert.equal(request.options.method, 'REPORT');
  assert.match(request.options.body, /calendar-query/);
});

test('fails REPORT with a partial response or missing calendar-data', async () => {
  const fetcher = async () =>
    ok(
      multi(
        response('/home/main/e1', '<c:calendar-data/>') +
          response(
            '/home/main/e2',
            '<c:calendar-data/>',
            'HTTP/1.1 403 Forbidden',
          ),
      ),
    );
  await assert.rejects(() =>
    fetchCalDavEvents(
      {
        url: 'https://caldav.yandex.com/home/main',
        username: 'u',
        password: 'p',
      },
      's',
      [],
      fetcher,
    ),
  );
});

test('rejects cross-origin redirect before forwarding credentials', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, authorization: options.headers.Authorization });
    return new Response('', {
      status: 302,
      headers: { location: 'https://evil.example/leak' },
    });
  };
  await assert.rejects(() =>
    discoverCalendars(
      { url: 'https://caldav.yandex.com/root', username: 'u', password: 'p' },
      [],
      fetcher,
    ),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://caldav.yandex.com/root');
  assert.equal(calls[0].authorization, auth('u', 'p'));
});

test('enforces resource and event limits', async () => {
  const tooMany = Array.from({ length: 501 }, (_, i) =>
    response(`/e${i}`, calProps()),
  ).join('');
  await assert.rejects(() =>
    discoverCalendars(
      { url: 'https://caldav.yandex.com/home', username: 'u', password: 'p' },
      [],
      async () => ok(multi(tooMany)),
    ),
  );
});
test('same-origin redirect uses final URL for relative collectionhrefs', async () => {
  const calls = [];
  const result = await discoverCalendars(
    { url: 'https://caldav.yandex.com/old', username: 'u', password: 'p' },
    [],
    async (url) => {
      calls.push(url);
      if (url.endsWith('/old'))
        return new Response(null, {
          status: 301,
          headers: { location: '/new/calendar/' },
        });
      return ok(multi(response('./', calProps('Moved'))));
    },
  );
  assert.deepEqual(result, [
    { url: 'https://caldav.yandex.com/new/calendar/', title: 'Moved' },
  ]);
  assert.equal(calls.length, 2);
});
test('optional failedproperties do not hide a successful calendar resource', async () => {
  const initial = response(
    '/root',
    '<c:calendar-home-set><d:href>/home/</d:href></c:calendar-home-set>',
  );
  const mixed = response('/home/main/', calProps('Main')).replace(
    '</d:response>',
    '<d:propstat><d:prop><c:supported-calendar-data/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>',
  );
  const result = await discoverCalendars(
    { url: 'https://caldav.yandex.com/root', username: 'u', password: 'p' },
    [],
    async (url) => ok(multi(url.endsWith('/root') ? initial : mixed)),
  );
  assert.equal(result.length, 1);
});
test('a failedREPORT member rejects the complete otherwisevalid snapshot', async () => {
  const good = response(
    '/a',
    `<c:calendar-data><![CDATA[${ics}]]></c:calendar-data>`,
  );
  for (const bad of [
    response('/b', '<c:calendar-data/>', 'HTTP/1.1 403 Forbidden'),
    response('/b', '<d:getetag/>'),
    good,
  ])
    await assert.rejects(() =>
      fetchCalDavEvents(
        { url: 'https://caldav.yandex.com/cal/', username: 'u', password: 'p' },
        's',
        [],
        async () => ok(multi(good + bad)),
        new Date('2026-09-08'),
      ),
    );
});
test('authentication errors, malformed XML and oversizedbodies never expose provider response', async () => {
  for (const reply of [
    () => ok('SECRET-PROVIDER-BODY', 401),
    () => ok('<!DOCTYPE x><x/>'),
    () => ok('x'.repeat(1000001)),
  ]) {
    await assert.rejects(
      () =>
        discoverCalendars(
          {
            url: 'https://caldav.yandex.com/root',
            username: 'u',
            password: 'private-password',
          },
          [],
          async () => reply(),
        ),
      (e) =>
        !e.message.includes('private-password') &&
        !e.message.includes('SECRET-PROVIDER-BODY'),
    );
  }
});
