import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareMutation } from '../lib/mutations.ts';
const base = process.env.LIFE_OS_TEST_URL;
test(
  'HTTP recurring lifecycle, scope cleanup and replay after materialization',
  { skip: !base },
  async () => {
    assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
    const req = async (path, body) => {
      const response = await fetch(base + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          Cookie: '__sites_local_auth=1',
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      assert.equal(response.status, 200, data.error);
      return data;
    };
    let state = await req('/api/state');
    let ruleId, cardId, tagId;
    const mutate = async (action) => {
      const mutation = prepareMutation(state, action);
      state = await req('/api/actions', { revision: state.revision, mutation });
      return mutation;
    };
    try {
      await mutate({
        type: 'tag.create',
        title: `Fixture ${crypto.randomUUID().slice(0, 8)}`,
        color: '#aabbcc',
      });
      tagId = state.tags.at(-1).id;
      const revision = state.revision;
      const create = await mutate({
        type: 'recurrence.create',
        title: 'HTTP repeat fixture',
        intervalMinutes: 4320,
        firstAt: new Date(Date.now() - 60000).toISOString(),
        tags: [tagId],
      });
      ruleId = state.recurrences.at(-1).id;
      const snapshots = await Promise.all([
        req('/api/state'),
        req('/api/state'),
      ]);
      state = snapshots[0];
      const occurrences = state.cards.filter((c) => c.recurrenceId === ruleId);
      assert.equal(occurrences.length, 1);
      cardId = occurrences[0].id;
      assert.equal(
        snapshots[1].cards.filter((c) => c.recurrenceId === ruleId).length,
        1,
      );
      assert.equal(state.recurrences.find((r) => r.id === ruleId).nextAt, null);
      state = await req('/api/actions', { revision, mutation: create });
      assert.equal(state.recurrences.filter((r) => r.id === ruleId).length, 1);
      assert.equal(
        state.cards.filter((c) => c.recurrenceId === ruleId).length,
        1,
      );
      const move = await mutate({ type: 'move', id: cardId, boardId: 'main' });
      const due = state.recurrences.find((r) => r.id === ruleId).nextAt;
      assert.equal(Date.parse(due), Date.parse(move.at) + 3 * 86400000);
      await mutate({ type: 'complete', id: cardId, done: true });
      assert.equal(state.recurrences.find((r) => r.id === ruleId).nextAt, due);
      await mutate({ type: 'tag.delete', id: tagId });
      tagId = null;
      assert.deepEqual(state.cards.find((c) => c.id === cardId).tags, []);
      assert.deepEqual(state.recurrences.find((r) => r.id === ruleId).tags, []);
    } finally {
      state = await req('/api/state');
      if (ruleId && state.recurrences.some((r) => r.id === ruleId))
        await mutate({ type: 'recurrence.delete', id: ruleId });
      if (cardId && state.cards.some((c) => c.id === cardId))
        await mutate({ type: 'delete', id: cardId });
      if (tagId && state.tags.some((t) => t.id === tagId))
        await mutate({ type: 'tag.delete', id: tagId });
    }
  },
);
