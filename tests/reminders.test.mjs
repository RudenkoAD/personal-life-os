import test from 'node:test';
import assert from 'node:assert/strict';
const { initialState, applyAction } = await import('../lib/domain.ts');
const { effectiveReminderMinutes } = await import('../lib/reminders.ts');
test('defaults and precedence distinguish null from explicit empty', () => {
  let s = initialState();
  s = applyAction(s, { type: 'reminders.defaults', minutes: [30, 10] });
  assert.deepEqual(s.reminderSettings.defaultMinutes, [30, 10]);
  s = applyAction(s, {
    type: 'reminders.defaults',
    scopeId: 'work',
    minutes: [60],
  });
  assert.deepEqual(s.reminderSettings.byTag.work, [60]);
  s = applyAction(s, {
    type: 'reminders.defaults',
    scopeId: 'work',
    minutes: null,
  });
  assert.equal(s.reminderSettings.byTag.work, undefined);
});
test('birthday preset and explicit empty override', () => {
  let s = initialState();
  s = applyAction(
    s,
    { type: 'event.create', startDate: '2026-09-20', birthday: { name: 'A' } },
    't',
    new Date(),
    () => 'bday',
  );
  const id = s.calendarSeries[0].id;
  assert.deepEqual(
    effectiveReminderMinutes(s, { kind: 'series', id }),
    [10080, 4320, 1440, 0],
  );
  s = applyAction(s, {
    type: 'reminders.set',
    target: { kind: 'series', id },
    minutes: [],
  });
  assert.deepEqual(effectiveReminderMinutes(s, { kind: 'series', id }), []);
});
test('external target is accepted and scheduled card required', () => {
  let s = initialState();
  assert.throws(
    () =>
      applyAction(s, {
        type: 'reminders.set',
        target: { kind: 'external', id: 'x' },
        minutes: [0],
      }),
    /Событие не найдено/,
  );
  assert.throws(
    () =>
      applyAction(s, {
        type: 'reminders.set',
        target: { kind: 'card', id: 'x' },
        minutes: [0],
      }),
    /запланирована/,
  );
});

test('external reminder resolution includes source and event tags', () => {
  let s = initialState();
  s.sources.push({
    id: 'source-1',
    title: 'Feed',
    color: '#fff',
    enabled: true,
    kind: 'file',
    tags: ['work'],
    lastSynced: '',
  });
  s.events.push({
    id: 'external-1',
    sourceId: 'source-1',
    uid: 'u1',
    title: 'External',
    start: '2026-09-14T07:00:00.000Z',
    end: '2026-09-14T08:00:00.000Z',
    allDay: false,
    tags: ['health'],
    location: '',
  });
  s = applyAction(s, {
    type: 'reminders.defaults',
    scopeId: 'work',
    minutes: [60],
  });
  s = applyAction(s, {
    type: 'reminders.defaults',
    scopeId: 'health',
    minutes: [30],
  });
  assert.deepEqual(
    effectiveReminderMinutes(s, { kind: 'external', id: 'external-1' }),
    [60, 30],
  );
});

test('explicit empty tag settings stop fallback to global defaults', () => {
  let s = initialState();
  s = applyAction(s, { type: 'reminders.defaults', minutes: [60] });
  s = applyAction(s, {
    type: 'reminders.defaults',
    scopeId: 'work',
    minutes: [],
  });
  s.events.push({
    id: 'external-1',
    sourceId: 'none',
    uid: 'u1',
    title: 'External',
    start: '2026-09-14T07:00:00.000Z',
    end: '2026-09-14T08:00:00.000Z',
    allDay: false,
    tags: ['work'],
    location: '',
  });
  assert.deepEqual(
    effectiveReminderMinutes(s, { kind: 'external', id: 'external-1' }),
    [],
  );
});
