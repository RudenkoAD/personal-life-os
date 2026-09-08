import test from 'node:test';
import assert from 'node:assert/strict';
const base = process.env.LIFE_OS_TEST_URL;
test(
  'HTTP persistence, CAS conflicts, scoped MCP and calendar preservation',
  { skip: !base },
  async () => {
    assert.match(
      base,
      /^http:\/\/(localhost|127\.0\.0\.1):\d+$/,
      'Use a local development server only',
    );
    const cookie = { Cookie: '__sites_local_auth=1' };
    const request = async (path, method = 'GET', body, headers = cookie) => {
      const r = await fetch(base + path, {
        method,
        headers: {
          ...headers,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await r.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text };
      }
      return { status: r.status, data };
    };
    let state = (await request('/api/state')).data;
    const ids = [],
      tokenHashes = [],
      sourceIds = [];
    const act = async (action) => {
      const r = await request('/api/actions', 'POST', {
        revision: state.revision,
        action,
      });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      state = r.data;
      return state;
    };
    try {
      assert.equal(
        (await request('/api/state', 'GET', undefined, {})).status,
        401,
      );
      assert.equal(
        (
          await request('/api/state', 'GET', undefined, {
            'oai-authenticated-user-id': 'forged',
            'oai-authenticated-user-email': 'forged@test.test',
          })
        ).status,
        401,
      );
      const startRevision = state.revision;
      await act({ type: 'capture', title: 'API test capture' });
      const card = state.cards.find((c) => c.title === 'API test capture');
      ids.push(card.id);
      assert.equal(card.placement, 'inbox');
      assert.equal(
        (await request('/api/state')).data.cards.some((c) => c.id === card.id),
        true,
      );
      await act({ type: 'move', id: card.id, boardId: 'main' });
      await act({
        type: 'schedule',
        id: card.id,
        start: '2026-09-08T10:00:00Z',
        end: '2026-09-08T11:00:00Z',
      });
      assert.equal(
        state.cards.find((c) => c.id === card.id).placement,
        'calendar',
      );
      const stale = await request('/api/actions', 'POST', {
        revision: startRevision,
        action: { type: 'delete', id: card.id },
      });
      assert.equal(stale.status, 409);
      const invalid = await request('/api/actions', 'POST', {
        revision: state.revision,
        action: {
          type: 'schedule',
          id: card.id,
          start: '2026-02-30T10:00:00Z',
          end: '2026-03-02T11:00:00Z',
        },
      });
      assert.equal(invalid.status, 400);
      assert.equal((await request('/api/state')).data.revision, state.revision);
      const crossOrigin = await request(
        '/api/actions',
        'POST',
        { revision: state.revision, action: { type: 'delete', id: card.id } },
        { ...cookie, Origin: 'https://evil.test' },
      );
      assert.equal(crossOrigin.status, 403);
      const concurrent = await Promise.all(
        ['A', 'B'].map((s) =>
          request('/api/actions', 'POST', {
            revision: state.revision,
            action: { type: 'capture', title: 'Race test ' + s },
          }),
        ),
      );
      assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
      state = (await request('/api/state')).data;
      ids.push(
        ...state.cards
          .filter((c) => c.title.startsWith('Race test '))
          .map((c) => c.id),
      );
      const read = await request('/api/tokens', 'POST', {
        name: 'Test read',
        scope: 'read',
      });
      assert.equal(read.status, 200);
      const readHeader = { Authorization: 'Bearer ' + read.data.token };
      assert.equal(
        (await request('/api/state', 'GET', undefined, readHeader)).status,
        200,
      );
      assert.equal(
        (
          await request(
            '/api/actions',
            'POST',
            {
              revision: state.revision,
              action: { type: 'capture', title: 'forbidden' },
            },
            readHeader,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            '/api/tokens',
            'POST',
            { name: 'Escalate', scope: 'write' },
            readHeader,
          )
        ).status,
        401,
      );
      const init = await request(
        '/api/mcp',
        'POST',
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        readHeader,
      );
      assert.equal(init.data.result.serverInfo.name, 'personal-life-os');
      const list = await request(
        '/api/mcp',
        'POST',
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        readHeader,
      );
      assert.equal(list.data.result.tools.length, 2);
      const writeDenied = await request(
        '/api/mcp',
        'POST',
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'life_act',
            arguments: {
              revision: state.revision,
              action: { type: 'capture', title: 'forbidden' },
            },
          },
        },
        readHeader,
      );
      assert.equal(writeDenied.status, 403);
      const write = await request('/api/tokens', 'POST', {
        name: 'Test write',
        scope: 'write',
      });
      const writeHeader = { Authorization: 'Bearer ' + write.data.token };
      const mcp = await request(
        '/api/mcp',
        'POST',
        {
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'life_act',
            arguments: {
              revision: state.revision,
              action: { type: 'move', id: card.id },
            },
          },
        },
        writeHeader,
      );
      assert.equal(mcp.status, 200);
      assert.equal(mcp.data.result.isError, undefined);
      state = JSON.parse(mcp.data.result.content[0].text);
      assert.equal(
        state.cards.find((c) => c.id === card.id).placement,
        'board',
      );
      assert.equal(state.history[0].actor, 'Агент: Test write');
      const tokenRows = (await request('/api/tokens')).data.filter(
        (t) => t.name === 'Test read' || t.name === 'Test write',
      );
      tokenHashes.push(...tokenRows.map((t) => t.hash));
      assert.equal(
        tokenRows.every((t) => !('token' in t)),
        true,
      );
      const readRow = tokenRows.find((t) => t.name === 'Test read');
      await request('/api/tokens', 'DELETE', { hash: readRow.hash });
      assert.equal(
        (await request('/api/state', 'GET', undefined, readHeader)).status,
        403,
      );
      const ics =
        'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:api-test\r\nDTSTART:20260908T100000Z\r\nDTEND:20260908T110000Z\r\nSUMMARY:API test event\r\nEND:VEVENT\r\nEND:VCALENDAR';
      const imported = await request('/api/calendars', 'POST', {
        revision: state.revision,
        title: 'API test calendar',
        ics,
        tags: ['study'],
      });
      assert.equal(imported.status, 200);
      state = imported.data;
      const source = state.sources.find((s) => s.title === 'API test calendar');
      sourceIds.push(source.id);
      assert.equal(
        state.events.find((e) => e.sourceId === source.id).tags[0],
        'study',
      );
      assert.equal(JSON.stringify(state).includes('BEGIN:VCALENDAR'), false);
      const invalidImport = await request('/api/calendars', 'POST', {
        revision: state.revision,
        title: 'Bad calendar',
        ics: 'invalid',
      });
      assert.equal(invalidImport.status, 400);
      assert.equal(
        (await request('/api/state')).data.events.some(
          (e) => e.sourceId === source.id,
        ),
        true,
      );
    } finally {
      state = (await request('/api/state')).data;
      for (const id of ids)
        if (state.cards.some((c) => c.id === id))
          await act({ type: 'delete', id });
      for (const id of sourceIds) await act({ type: 'source.remove', id });
      for (const hash of tokenHashes)
        await request('/api/tokens', 'DELETE', { hash });
    }
  },
);
