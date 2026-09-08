import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareMutation } from '../lib/mutations.ts';
const base = process.env.LIFE_OS_TEST_URL;
test(
  'HTTP mutation receipts: retries, concurrent duplicates, changed payload and stale revision',
  { skip: !base },
  async () => {
    assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
    const req = async (path, body) => {
      const r = await fetch(base + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          Cookie: '__sites_local_auth=1',
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, data: await r.json() };
    };
    let state = (await req('/api/state')).data;
    const ids = [];
    const mutate = async (action) => {
      const mutation = prepareMutation(state, action);
      const result = await req('/api/actions', {
        revision: state.revision,
        mutation,
      });
      assert.equal(result.status, 200, JSON.stringify(result.data));
      state = result.data;
      return mutation;
    };
    try {
      const before = state.revision,
        m = prepareMutation(state, {
          type: 'capture',
          title: 'Mutation receipt fixture',
        });
      const pair = await Promise.all([
        req('/api/actions', { revision: before, mutation: m }),
        req('/api/actions', { revision: before, mutation: m }),
      ]);
      assert.deepEqual(
        pair.map((x) => x.status),
        [200, 200],
      );
      state = (await req('/api/state')).data;
      const cards = state.cards.filter(
        (c) => c.title === 'Mutation receipt fixture',
      );
      assert.equal(cards.length, 1);
      ids.push(cards[0].id);
      assert.equal(state.revision, before + 1);
      await mutate({ type: 'update', id: ids[0], title: 'Newer value' });
      const revision = state.revision;
      const replay = await req('/api/actions', {
        revision: before,
        mutation: m,
      });
      assert.equal(replay.status, 200);
      assert.equal(replay.data.revision, revision);
      assert.equal(
        replay.data.cards.find((c) => c.id === ids[0]).title,
        'Newer value',
      );
      const changed = await req('/api/actions', {
        revision: state.revision,
        mutation: { ...m, action: { ...m.action, title: 'Different payload' } },
      });
      assert.equal(changed.status, 422);
      const stale = prepareMutation(state, {
        type: 'capture',
        title: 'Must not exist',
      });
      assert.equal(
        (await req('/api/actions', { revision: before, mutation: stale }))
          .status,
        409,
      );
      const ack = await req(
        '/api/state?mutations=' +
          encodeURIComponent([m.id, stale.id].join(',')),
      );
      assert.deepEqual(ack.data.applied, [m.id]);
      assert.equal(
        (await req('/api/actions', { revision: state.revision })).status,
        400,
      );
    } finally {
      state = (await req('/api/state')).data;
      for (const id of ids)
        if (state.cards.some((c) => c.id === id))
          await mutate({ type: 'delete', id });
    }
  },
);
