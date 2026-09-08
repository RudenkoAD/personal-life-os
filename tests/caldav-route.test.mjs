import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(spec, context, next) {
    if (spec === 'cloudflare:workers')
      return {
        url: new URL('./d1-env.mjs', import.meta.url).href,
        shortCircuit: true,
      };
    if (spec === '@/app/chatgpt-auth')
      return {
        url: 'data:text/javascript,export async function getChatGPTUser(){return globalThis.calendarTestUser}',
        shortCircuit: true,
      };
    if (spec.startsWith('@/'))
      return {
        url: new URL('../' + spec.slice(2) + '.ts', import.meta.url).href,
        shortCircuit: true,
      };
    return next(spec, context);
  },
});
const { env } = await import('./d1-env.mjs');
const { POST } = await import('../app/api/calendars/route.ts');
const { loadState, rawDb, saveState } = await import('../db/store.ts');
const { applyAction } = await import('../lib/domain.ts');
const xml = (content) =>
  `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${content}</d:multistatus>`;
const row = (props) =>
  `<d:response><d:href>/calendar/</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const now = new Date(),
  start = new Date(now.getTime() + 3600000)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z'),
  end = new Date(now.getTime() + 7200000)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:caldav-route\r\nDTSTART:${start}\r\nDTEND:${end}\r\nSUMMARY:Fixture event\r\nEND:VEVENT\r\nEND:VCALENDAR`;
const request = async (body) => {
  const r = await POST(
    new Request('https://life.example/api/calendars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: r.status, data: await r.json() };
};
test('CalDAV route discovers without mutation, encrypts onadd, preserves events onfailedrefresh and removes credentials', async () => {
  const original = globalThis.fetch;
  globalThis.calendarTestUser = { userId: 'caldav-route-owner' };
  env.CALDAV_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString('base64');
  let response = xml(
    row(
      '<d:displayname>Test calendar</d:displayname><d:resourcetype><c:calendar/></d:resourcetype>',
    ),
  );
  globalThis.fetch = async () => new Response(response, { status: 207 });
  const login = {
    mode: 'caldav',
    url: 'https://caldav.yandex.ru/calendar/',
    username: 'test-user',
    password: 'secret-fixture',
  };
  try {
    const before = await loadState('caldav-route-owner');
    const discovery = await request({ ...login, operation: 'discover' });
    assert.equal(discovery.status, 200);
    assert.equal(discovery.data.calendars.length, 1);
    assert.deepEqual(await loadState('caldav-route-owner'), before);
    response = xml(
      row(`<c:calendar-data><![CDATA[${ics}]]></c:calendar-data>`),
    );
    let added = await request({
      ...login,
      title: 'CalDAV fixture',
      revision: before.revision,
      tags: ['study'],
    });
    assert.equal(added.status, 200);
    let state = added.data;
    const source = state.sources.find((s) => s.kind === 'caldav');
    assert.ok(source);
    assert.equal(
      state.events.find((e) => e.sourceId === source.id).tags[0],
      'study',
    );
    const stored = await rawDb()
      .prepare('SELECT credentials FROM caldav_connections WHERE id = ?')
      .bind(source.id)
      .first();
    assert.match(stored.credentials, /^v1\./);
    assert.equal(JSON.stringify(state).includes(login.password), false);
    assert.equal(JSON.stringify(state).includes(login.username), false);
    assert.equal(JSON.stringify(state).includes(login.url), false);
    assert.equal(stored.credentials.includes(login.password), false);
    response = xml(row('<d:getetag>missing calendar data</d:getetag>'));
    const bad = await request({
      sourceId: source.id,
      revision: state.revision,
    });
    assert.equal(bad.status, 400);
    assert.deepEqual(await loadState('caldav-route-owner'), state);
    const stale = await request({
      ...login,
      title: 'Duplicate',
      revision: before.revision,
    });
    assert.equal(stale.status, 409);
    response = xml('');
    const refreshed = await request({
      sourceId: source.id,
      revision: state.revision,
    });
    assert.equal(refreshed.status, 200);
    state = refreshed.data;
    assert.equal(
      state.events.filter((e) => e.sourceId === source.id).length,
      0,
    );
    const deleted = applyAction(state, {
      type: 'source.remove',
      id: source.id,
    });
    await saveState('caldav-route-owner', state.revision, deleted, {
      kind: 'delete',
      id: source.id,
    });
    assert.equal(
      await rawDb()
        .prepare('SELECT id FROM caldav_connections WHERE id = ?')
        .bind(source.id)
        .first(),
      null,
    );
    globalThis.calendarTestUser = null;
    assert.equal(
      (await request({ ...login, operation: 'discover' })).status,
      401,
    );
  } finally {
    globalThis.fetch = original;
    delete globalThis.calendarTestUser;
  }
});
