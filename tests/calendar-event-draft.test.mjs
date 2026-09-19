import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toEventDraft,
  eventDraftFields,
  rebaseEventDraft,
} from '../lib/calendar-event-draft.ts';
const base = {
  title: 'Meeting',
  notes: '',
  location: '',
  tags: [],
  allDay: false,
  startDate: '2026-09-01',
  startTime: '22:00',
  durationMinutes: 120,
};
const repeat = { frequency: 'weekly', interval: 1, weekdays: [2] };
test('selected calendar interval fills exact editor end including next-day midnight', () => {
  const selected = { ...base, startTime: '10:15', durationMinutes: 105 };
  const draft = toEventDraft(selected, { frequency: 'none', interval: 1 });
  assert.equal(draft.endTime, '12:00');
  assert.equal(draft.endDate, selected.startDate);
  assert.deepEqual(eventDraftFields(draft), selected);
  const midnight = toEventDraft(
    { ...base, startTime: '23:15', durationMinutes: 45 },
    { frequency: 'none', interval: 1 },
  );
  assert.equal(midnight.endDate, '2026-09-02');
  assert.equal(midnight.endTime, '00:00');
  assert.equal(eventDraftFields(midnight).durationMinutes, 45);
});
test('switching to series carries a midnight edit as duration without shifting the anchor', () => {
  const original = toEventDraft({ ...base, startDate: '2026-09-15' }, repeat);
  const draft = {
    ...original,
    startTime: '01:00',
    endDate: '2026-09-15',
    endTime: '03:00',
    title: 'Updated',
  };
  const rebased = rebaseEventDraft(draft, original, base, repeat);
  assert.equal(rebased.startDate, '2026-09-01');
  assert.equal(rebased.endDate, '2026-09-01');
  assert.equal(rebased.title, 'Updated');
  assert.equal(eventDraftFields(rebased).durationMinutes, 120);
});
test('all-day date roundtrip uses inclusive editor end and fixed Moscow time even for historical anchors', () => {
  const fields = {
    ...base,
    startDate: '1900-01-01',
    startTime: '00:00',
    allDay: true,
    durationMinutes: 2880,
  };
  const draft = toEventDraft(fields, repeat);
  assert.equal(draft.endDate, '1900-01-02');
  assert.deepEqual(eventDraftFields(draft), fields);
});
test('incomplete date draft cannot crash or discard edits when switching scope', () => {
  const original = toEventDraft(base, repeat);
  const draft = { ...original, endDate: '', title: 'Unsaved' };
  assert.throws(() => rebaseEventDraft(draft, original, base, repeat));
  assert.equal(draft.title, 'Unsaved');
});

test('birthday editor fields remain a one-day all-day yearly draft', () => {
  const fields = {
    ...base,
    title: 'День рождения Анна',
    startDate: '2028-02-29',
    startTime: '00:00',
    allDay: true,
    durationMinutes: 1440,
  };
  const draft = toEventDraft(fields, { frequency: 'yearly', interval: 1 });
  assert.equal(draft.endDate, '2028-02-29');
  assert.equal(draft.endTime, '00:00');
  assert.deepEqual(eventDraftFields(draft), fields);
});
