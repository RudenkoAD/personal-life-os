import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareMutation } from '../lib/mutations.ts';
import { eventOnDate } from '../lib/calendar-events.ts';
const base = process.env.LIFE_OS_TEST_URL;
test(
  'HTTP fixed events persist, replay once and support MCP one-occurrence actions',
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
    const rpc = (name, args = {}) =>
      req('/api/mcp', {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      });
    let state = await req('/api/state');
    let id;
    const mutate = async (action) => {
      const mutation = prepareMutation(state, action),
        revision = state.revision;
      state = await req('/api/actions', { revision, mutation });
      return { revision, mutation };
    };
    try {
      const initialCardIds = state.cards.map((card) => card.id);
      const sent = await mutate({
        type: 'event.create',
        title: 'Fixed-event HTTP fixture',
        startDate: '2026-09-08',
        startTime: '11:00',
        repeat: { frequency: 'weekly', interval: 1, weekdays: [2] },
      });
      id = state.calendarSeries.at(-1).id;
      state = await req('/api/actions', sent);
      assert.equal(state.calendarSeries.filter((s) => s.id === id).length, 1);
      assert.deepEqual(
        state.cards.map((card) => card.id),
        initialCardIds,
      );
      state = await req('/api/state');
      assert.equal(
        eventOnDate(
          state.calendarSeries.find((s) => s.id === id),
          '2026-09-15',
        ).start,
        '2026-09-15T11:00:00+03:00',
      );
      const changed = await rpc('life_act', {
        revision: state.revision,
        action: {
          type: 'event.override',
          id,
          occurrenceDate: '2026-09-15',
          patch: { startTime: '12:15', durationMinutes: 90 },
        },
      });
      assert.equal(changed.result.isError, undefined);
      state = JSON.parse(changed.result.content[0].text);
      assert.equal(
        eventOnDate(
          state.calendarSeries.find((s) => s.id === id),
          '2026-09-15',
        ).start,
        '2026-09-15T12:15:00+03:00',
      );
      const stale = await rpc('life_act', {
        revision: state.revision - 1,
        action: { type: 'event.delete', id },
      });
      assert.equal(stale.result.isError, true);
      await mutate({
        type: 'event.override',
        id,
        occurrenceDate: '2026-09-22',
        cancelled: true,
      });
      const read = await rpc('life_read');
      state = JSON.parse(read.result.content[0].text);
      assert.equal(
        eventOnDate(
          state.calendarSeries.find((s) => s.id === id),
          '2026-09-22',
        ),
        null,
      );
      await mutate({ type: 'event.restore', id, occurrenceDate: '2026-09-22' });
      assert.ok(
        eventOnDate(
          state.calendarSeries.find((s) => s.id === id),
          '2026-09-22',
        ),
      );
    } finally {
      state = await req('/api/state');
      if (id && state.calendarSeries.some((s) => s.id === id))
        await mutate({ type: 'event.delete', id });
    }
  },
);
