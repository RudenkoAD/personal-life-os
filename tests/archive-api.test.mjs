import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareMutation } from '../lib/mutations.ts';
const base = process.env.LIFE_OS_TEST_URL;

test(
  'archive setting persists through HTTP and completion has the same semantics through MCP',
  { skip: !base },
  async () => {
    assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
    const request = async (path, body) => {
      const r = await fetch(base + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          Cookie: '__sites_local_auth=1',
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await r.json();
      assert.equal(r.status, 200, JSON.stringify(data));
      return data;
    };
    let state = await request('/api/state');
    const originalSetting = state.settings.autoArchiveCompleted;
    let id;
    const mutate = async (action) => {
      state = await request('/api/actions', {
        revision: state.revision,
        mutation: prepareMutation(state, action),
      });
    };
    try {
      await mutate({ type: 'settings.update', autoArchiveCompleted: false });
      state = await request('/api/state');
      assert.equal(state.settings.autoArchiveCompleted, false);
      await mutate({
        type: 'capture',
        title: 'Archive HTTP fixture ' + crypto.randomUUID(),
      });
      id = state.cards[0].id;
      await mutate({ type: 'complete', id, done: true });
      assert.equal(state.cards.find((c) => c.id === id).archived, false);
      const response = await request('/api/mcp', {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'life_act',
          arguments: {
            revision: state.revision,
            action: { type: 'settings.update', autoArchiveCompleted: true },
          },
        },
      });
      assert.ok(!response.result.isError, JSON.stringify(response));
      state = JSON.parse(response.result.content[0].text);
      assert.equal(state.cards.find((c) => c.id === id).archived, true);
      const reopened = await request('/api/mcp', {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'life_act',
          arguments: {
            revision: state.revision,
            action: { type: 'complete', id, done: false },
          },
        },
      });
      assert.ok(!reopened.result.isError, JSON.stringify(reopened));
      state = await request('/api/state');
      const card = state.cards.find((c) => c.id === id);
      assert.equal(card.archived, false);
      assert.equal(card.done, false);
      assert.equal(card.placement, 'inbox');
    } finally {
      state = await request('/api/state');
      if (id && state.cards.some((c) => c.id === id))
        await mutate({ type: 'delete', id });
      await mutate({
        type: 'settings.update',
        autoArchiveCompleted: originalSetting,
      });
    }
  },
);
