import test from 'node:test';
import assert from 'node:assert/strict';

const { initialState, applyAction, DomainError } =
  await import('../lib/domain.ts');
const { applyMutation } = await import('../lib/mutations.ts');
const { eventOnDate } = await import('../lib/calendar-events.ts');

const at = (value) => new Date(`${value}Z`);
const ids = (() => {
  let n = 0;
  return () => `fixed-test-${++n}`;
})();
const act = (state, action) =>
  applyAction(state, action, 'fixed-test', at('2026-09-08T09:00:00.000'), ids);
const series = (state) => state.calendarSeries[0];
const mutation = (action) => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  at: '2026-09-08T09:00:00.000Z',
  action,
});

test('initial and legacy states expose empty calendar series', () => {
  const state = initialState();
  assert.deepEqual(state.calendarSeries, []);
  const legacy = structuredClone(state);
  delete legacy.calendarSeries;
  const loaded = applyAction(
    legacy,
    { type: 'capture', title: 'normalizes' },
    'test',
    at('2026-09-08T09:00:00.000'),
    ids,
  );
  assert.deepEqual(loaded.calendarSeries, []);
});

test('weekly event create has validated defaults and deterministic mutation projection', () => {
  const action = {
    type: 'event.create',
    title: 'Встреча',
    startDate: '2026-09-14',
    repeat: { frequency: 'weekly', interval: 1, weekdays: [1] },
  };
  const state = applyMutation(initialState(), mutation(action));
  assert.equal(state.calendarSeries.length, 1);
  assert.equal(series(state).id, 'm_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa_0');
  assert.equal(series(state).startTime, '09:00');
  assert.equal(series(state).durationMinutes, 60);
  assert.deepEqual(series(state).exceptions, {});
  const replay = applyMutation(initialState(), mutation(action));
  assert.deepEqual(replay.calendarSeries, state.calendarSeries);
});

test('event actions accept arbitrary whole-minute timed durations on create, update, and override', () => {
  let state = act(initialState(), {
    type: 'event.create',
    title: 'Minute event',
    startDate: '2026-09-14',
    startTime: '10:01',
    durationMinutes: 17,
  });
  const id = series(state).id;
  assert.equal(series(state).durationMinutes, 17);
  state = act(state, { type: 'event.update', id, durationMinutes: 10079 });
  assert.equal(series(state).durationMinutes, 10079);
  state = act(state, {
    type: 'event.override',
    id,
    occurrenceDate: '2026-09-14',
    patch: { durationMinutes: 1 },
  });
  assert.equal(series(state).exceptions['2026-09-14'].durationMinutes, 1);
  assert.equal(
    eventOnDate(series(state), '2026-09-14').end,
    '2026-09-14T07:02:00.000Z',
  );
});

test('occurrence override stores explicit inherited fields; later series edit preserves override', () => {
  let state = act(initialState(), {
    type: 'event.create',
    title: 'Weekly',
    startDate: '2026-09-14',
    startTime: '10:00',
    durationMinutes: 45,
    repeat: { frequency: 'weekly', interval: 1, weekdays: [1] },
  });
  const id = series(state).id;
  state = act(state, {
    type: 'event.update',
    id,
    title: 'Renamed',
    startTime: '11:00',
  });
  state = act(state, {
    type: 'event.override',
    id,
    occurrenceDate: '2026-09-21',
    patch: { title: 'One off', startTime: '12:00' },
  });
  assert.equal(series(state).exceptions['2026-09-21'].title, 'One off');
  assert.equal(series(state).exceptions['2026-09-21'].startTime, '12:00');
  assert.equal(eventOnDate(series(state), '2026-09-21').title, 'One off');
  assert.equal(
    eventOnDate(series(state), '2026-09-21').start,
    '2026-09-21T12:00:00+03:00',
  );
  state = act(state, {
    type: 'event.update',
    id,
    title: 'Final',
    startTime: '13:00',
  });
  assert.equal(series(state).exceptions['2026-09-21'].title, 'One off');
  assert.equal(series(state).exceptions['2026-09-21'].startTime, '12:00');
  assert.equal(series(state).startTime, '13:00');
});

test('cancel and restore affect one valid occurrence only', () => {
  let state = act(initialState(), {
    type: 'event.create',
    title: 'Birthday',
    startDate: '2026-02-28',
    allDay: true,
    repeat: { frequency: 'yearly', interval: 1 },
  });
  const id = series(state).id;
  state = act(state, {
    type: 'event.override',
    id,
    occurrenceDate: '2027-02-28',
    cancelled: true,
  });
  assert.equal(series(state).exceptions['2027-02-28'].cancelled, true);
  state = act(state, {
    type: 'event.restore',
    id,
    occurrenceDate: '2027-02-28',
  });
  assert.equal(series(state).exceptions['2027-02-28'], undefined);
});

test('invalid fields, dates, repeats and non-occurrences are atomic', () => {
  const initial = initialState();
  for (const action of [
    { type: 'event.create', title: '', startDate: '2026-09-14' },
    { type: 'event.create', title: 'bad', startDate: '2026-02-30' },
    {
      type: 'event.create',
      title: 'bad',
      startDate: '2026-09-14',
      repeat: { frequency: 'weekly', interval: 1, weekdays: [7] },
    },
    {
      type: 'event.create',
      title: 'bad',
      startDate: '2026-09-14',
      repeat: { frequency: 'weekly', interval: 1, weekdays: [1] },
      durationMinutes: 0,
    },
  ]) {
    assert.throws(
      () => act(initial, action),
      (error) => error instanceof DomainError || error instanceof Error,
    );
    assert.deepEqual(initial.calendarSeries, []);
  }
  const state = act(initial, {
    type: 'event.create',
    title: 'Weekly',
    startDate: '2026-09-14',
    repeat: { frequency: 'weekly', interval: 1, weekdays: [1] },
  });
  assert.throws(() =>
    act(state, {
      type: 'event.override',
      id: series(state).id,
      occurrenceDate: '2026-09-15',
      patch: { title: 'bad' },
    }),
  );
});

test('tag deletion cascades to series while old interval task rules remain intact', () => {
  let state = act(initialState(), {
    type: 'event.create',
    title: 'Tagged',
    startDate: '2026-09-14',
    tags: ['life'],
    repeat: { frequency: 'weekly', interval: 1, weekdays: [1] },
  });
  state = act(state, {
    type: 'event.override',
    id: series(state).id,
    occurrenceDate: '2026-09-14',
    patch: { tags: ['life'] },
  });
  state = act(state, {
    type: 'recurrence.create',
    title: 'Inbox task',
    tags: ['life'],
    intervalMinutes: 60,
    firstAt: '2026-09-08T09:00:00Z',
  });
  state = act(state, { type: 'tag.delete', id: 'life' });
  assert.deepEqual(series(state).tags, []);
  assert.deepEqual(series(state).exceptions['2026-09-14'].tags, []);
  assert.deepEqual(state.recurrences[0].tags, []);
  assert.equal(state.recurrences.length, 1);
});

test('event series delete does not touch cards or interval task rules', () => {
  let state = act(initialState(), {
    type: 'event.create',
    title: 'Keep task separate',
    startDate: '2026-09-14',
  });
  state = act(state, { type: 'capture', title: 'Inbox card' });
  state = act(state, {
    type: 'recurrence.create',
    title: 'Interval',
    intervalMinutes: 60,
    firstAt: '2026-09-08T09:00:00Z',
  });
  state = act(state, { type: 'event.delete', id: series(state).id });
  assert.equal(state.calendarSeries.length, 0);
  assert.equal(state.cards.length, 1);
  assert.equal(state.recurrences.length, 1);
});
