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
        url: 'data:text/javascript,export async function getChatGPTUser(){return globalThis.icsFixtureUser}',
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
const { POST } = await import('../app/api/calendars/route.ts');
const { POST: mcp } = await import('../app/api/mcp/route.ts');
const { GET: getState } = await import('../app/api/state/route.ts');
const { loadState, saveState, rawDb } = await import('../db/store.ts');
const { applyAction } = await import('../lib/domain.ts');
const request = async (payload) => {
  const response = await POST(
    new Request('https://life.example/api/calendars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
  return { status: response.status, data: await response.json() };
};
const icsTime = (offset) =>
  new Date(Date.now() + offset)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:ics-signed-fixture\r\nDTSTART:${icsTime(3600000)}\r\nDTEND:${icsTime(7200000)}\r\nSUMMARY:Fixture class\r\nEND:VEVENT\r\nEND:VCALENDAR`;
const firstUrl =
  'https://lk.dataschool.yandex.ru/users/fixture-private-signature/classes.ics';
const nextUrl =
  'https://lk.dataschool.yandex.ru/users/fixture-renewed-signature/classes.ics?token=fixture%2Bquery%3D';

test('signed link persists privately, refreshes unchanged and renews without losing source/event identity', async () => {
  const originalFetch = globalThis.fetch,
    owner = 'signed-feed-fixture';
  const calls = [];
  globalThis.icsFixtureUser = { userId: owner };
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(ics, { headers: { 'Content-Type': 'text/calendar' } });
  };
  try {
    const before = await loadState(owner);
    let result = await request({
      revision: before.revision,
      title: 'DataSchool fixture',
      url: firstUrl,
      tags: ['study'],
    });
    assert.equal(result.status, 200);
    let state = result.data;
    const sourceId = state.sources[0].id,
      eventId = state.events[0].id;
    const stored = () =>
      rawDb()
        .prepare('SELECT url FROM feeds WHERE id = ? AND owner_id = ?')
        .bind(sourceId, owner)
        .first();
    assert.equal((await stored()).url, firstUrl);
    assert.equal(
      JSON.stringify(state).includes('fixture-private-signature'),
      false,
    );
    result = await request({ sourceId, revision: state.revision });
    assert.equal(result.status, 200);
    state = result.data;
    assert.deepEqual(calls, [firstUrl, firstUrl]);
    result = await request({
      sourceId,
      revision: state.revision,
      url: nextUrl,
    });
    assert.equal(result.status, 200);
    state = result.data;
    assert.equal((await stored()).url, nextUrl);
    assert.equal(state.sources.length, 1);
    assert.equal(state.sources[0].id, sourceId);
    assert.equal(state.sources[0].title, 'DataSchool fixture');
    assert.equal(state.events[0].id, eventId);
    assert.deepEqual(state.events[0].tags, ['study']);
    result = await request({ sourceId, revision: state.revision });
    state = result.data;
    assert.equal(calls.at(-1), nextUrl);
    const apiState = await getState(
      new Request('https://life.example/api/state'),
    );
    const mcpState = await mcp(
      new Request('https://life.example/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'life_read' },
        }),
      }),
    );
    for (const body of [
      JSON.stringify(state),
      await apiState.text(),
      await mcpState.text(),
    ])
      for (const secret of [
        firstUrl,
        nextUrl,
        'fixture-private-signature',
        'fixture-renewed-signature',
        'fixture%2Bquery',
      ])
        assert.equal(body.includes(secret), false);
    const removed = applyAction(state, { type: 'source.remove', id: sourceId });
    await saveState(owner, state.revision, removed, {
      kind: 'delete',
      id: sourceId,
    });
    assert.equal(await stored(), null);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.icsFixtureUser;
  }
});

test('failed, stale and foreign-owner replacements preserve credentials and events', async () => {
  const originalFetch = globalThis.fetch,
    owner = 'signed-feed-failures';
  let fetches = 0,
    reply = () => new Response(ics);
  globalThis.icsFixtureUser = { userId: owner };
  globalThis.fetch = async () => {
    fetches++;
    return reply();
  };
  try {
    const before = await loadState(owner);
    let result = await request({
      revision: before.revision,
      title: 'Fixture',
      url: firstUrl,
    });
    assert.equal(result.status, 200);
    const state = result.data;
    const sourceId = state.sources[0].id;
    const stored = () =>
      rawDb()
        .prepare('SELECT url FROM feeds WHERE id = ? AND owner_id = ?')
        .bind(sourceId, owner)
        .first();
    for (const fail of [
      () => new Response(nextUrl, { status: 403 }),
      () =>
        new Response('<html>' + nextUrl + '</html>', {
          headers: { 'Content-Type': 'text/html' },
        }),
      () => new Response('invalid ICS ' + nextUrl),
      () => {
        throw new Error(nextUrl);
      },
    ]) {
      reply = fail;
      result = await request({
        sourceId,
        revision: state.revision,
        url: nextUrl,
      });
      assert.equal(result.status, 400);
      assert.equal(
        JSON.stringify(result.data).includes('fixture-renewed-signature'),
        false,
      );
      assert.deepEqual(await loadState(owner), state);
      assert.equal((await stored()).url, firstUrl);
    }
    const count = fetches;
    result = await request({
      sourceId,
      revision: state.revision,
      url: 'https://lk.dataschool.yandex.ru.evil.test/calendar.ics',
    });
    assert.equal(result.status, 400);
    result = await request({
      sourceId,
      revision: state.revision - 1,
      url: nextUrl,
    });
    assert.equal(result.status, 409);
    assert.equal(fetches, count);
    globalThis.icsFixtureUser = { userId: 'different-ics-owner' };
    const other = await loadState('different-ics-owner');
    result = await request({
      sourceId,
      revision: other.revision,
      url: nextUrl,
    });
    assert.equal(result.status, 404);
    assert.equal(fetches, count);
    globalThis.icsFixtureUser = { userId: owner };
    reply = async () => {
      const fresh = await loadState(owner);
      await saveState(
        owner,
        fresh.revision,
        applyAction(fresh, { type: 'capture', title: 'Concurrent edit' }),
      );
      return new Response(ics);
    };
    result = await request({
      sourceId,
      revision: state.revision,
      url: nextUrl,
    });
    assert.equal(result.status, 409);
    assert.equal((await stored()).url, firstUrl);
    const fresh = await loadState(owner);
    assert.deepEqual(fresh.sources, state.sources);
    assert.deepEqual(fresh.events, state.events);
    assert.equal(fresh.cards.at(-1).title, 'Concurrent edit');
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.icsFixtureUser;
  }
});
