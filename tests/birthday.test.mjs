import test from 'node:test';
import assert from 'node:assert/strict';
const { initialState, applyAction } = await import('../lib/domain.ts');
const { birthdayDate } = await import('../lib/birthdays.ts');
const { materializeEventTasks } = await import('../lib/event-tasks.ts');
const { eventOnDate } = await import('../lib/calendar-events.ts');

const create = (startDate, name = 'Аня') => {
  let state = initialState(new Date('2026-01-01T00:00:00Z'));
  state = applyAction(
    state,
    { type: 'event.create', startDate, birthday: { name } },
    'test',
    new Date('2026-01-01T00:00:00Z'),
    () => 'birthday-id',
  );
  return state;
};

test('birthday is canonical yearly all-day event and has leap-day fallback', () => {
  const state = create('2024-02-29', 'Лена');
  const series = state.calendarSeries[0];
  assert.equal(series.title, 'День рождения Лена');
  assert.equal(series.allDay, true);
  assert.equal(series.durationMinutes, 1440);
  assert.deepEqual(series.repeat, { frequency: 'yearly', interval: 1 });
  assert.equal(birthdayDate(series, 2025), '2025-02-28');
  assert.ok(eventOnDate(series, '2025-02-28'));
});

test('gift appears once from 7 days before through birthday after 09:00 Moscow', () => {
  let state = create('2026-09-20', 'Оля');
  state = materializeEventTasks(state, new Date('2026-09-13T06:00:00Z')); // 09:00 Moscow
  assert.equal(state.cards.length, 1);
  const revision = state.revision;
  state = materializeEventTasks(state, new Date('2026-09-15T12:00:00Z'));
  assert.equal(state.cards.length, 1);
  assert.equal(state.revision, revision);
  assert.equal(Object.keys(state.eventTaskRuns).length, 1);
});

test('birthday update renames the canonical series and keeps existing exception data', () => {
  let state = create('2026-09-20');
  const id = state.calendarSeries[0].id;
  state = applyAction(
    state,
    { type: 'event.update', id, birthday: { name: 'Ира' } },
    'test',
  );
  assert.equal(state.calendarSeries[0].title, 'День рождения Ира');
  state.calendarSeries[0].exceptions['2026-09-20'] = { notes: 'x' };
  state = applyAction(
    state,
    { type: 'event.update', id, birthday: { name: 'Кира' } },
    'test',
    new Date('2026-01-02T00:00:00Z'),
    () => 'x',
  );
  assert.equal(state.calendarSeries[0].title, 'День рождения Кира');
  assert.deepEqual(state.calendarSeries[0].exceptions['2026-09-20'], {
    notes: 'x',
  });
});

test('renaming birthday preserves an explicit empty task-rule override', () => {
  let state = create('2026-09-20');
  const id = state.calendarSeries[0].id;
  state = applyAction(
    state,
    { type: 'reminders.set', target: { kind: 'series', id }, minutes: [] },
    'test',
    new Date('2026-01-01T00:00:00Z'),
    () => 'x',
  );
  state = applyAction(
    state,
    { type: 'event.update', id, birthday: { name: 'Ира' } },
    'test',
    new Date('2026-01-02T00:00:00Z'),
    () => 'x',
  );
  assert.deepEqual(state.reminderSettings.overrides[`series:${id}`], []);
  assert.equal(state.calendarSeries[0].title, 'День рождения Ира');
});

test('ordinary event converted to birthday gets birthday task preset without losing metadata', () => {
  let state = initialState(new Date('2026-01-01T00:00:00Z'));
  state = applyAction(
    state,
    {
      type: 'event.create',
      title: 'Обычное',
      startDate: '2026-09-20',
      notes: 'meta',
      location: 'Дом',
    },
    'test',
    new Date('2026-01-01T00:00:00Z'),
    () => 'ordinary',
  );
  state = applyAction(
    state,
    { type: 'event.update', id: 'ordinary', birthday: { name: 'Оля' } },
    'test',
    new Date('2026-01-02T00:00:00Z'),
    () => 'ordinary',
  );
  assert.equal(state.calendarSeries[0].notes, 'meta');
  assert.equal(state.calendarSeries[0].location, 'Дом');
  assert.equal(state.eventTaskRules['series:ordinary'][0].minutesBefore, 10080);
});
