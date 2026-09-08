import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCalendar, validateFeedUrl } from '../lib/ical.ts';
const now = new Date('2026-09-08T09:00:00Z');
const wrap = (s) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Life OS//Test//EN\r\n${s}\r\nEND:VCALENDAR`;
const event = (
  extra = '',
  start = '20260908T100000Z',
  end = '20260908T110000Z',
) =>
  `BEGIN:VEVENT\r\nUID:event-1\r\nDTSTART:${start}\r\nDTEND:${end}\r\nSUMMARY:Test event\r\n${extra}\r\nEND:VEVENT`;
test('stable source-scoped IDs, no duplicate event UIDs within source', () => {
  const a = parseCalendar(wrap(event()), 'a', now);
  assert.equal(a.length, 1);
  assert.deepEqual(parseCalendar(wrap(event()), 'a', now), a);
  assert.notEqual(parseCalendar(wrap(event()), 'b', now)[0].id, a[0].id);
  assert.equal(
    parseCalendar(wrap(event() + '\r\n' + event()), 'a', now).length,
    1,
  );
});
test('recurrence and EXDATE expansion', () => {
  const a = parseCalendar(
    wrap(event('RRULE:FREQ=DAILY;COUNT=3\r\nEXDATE:20260909T100000Z')),
    'a',
    now,
  );
  assert.equal(a.length, 2);
  assert.deepEqual(
    a.map((e) => e.start),
    ['2026-09-08T10:00:00.000Z', '2026-09-10T10:00:00.000Z'],
  );
});
test('moved recurrence exception replaces occurrence', () => {
  const moved = `BEGIN:VEVENT\r\nUID:event-1\r\nRECURRENCE-ID:20260909T100000Z\r\nDTSTART:20260909T120000Z\r\nDTEND:20260909T130000Z\r\nSUMMARY:Moved\r\nEND:VEVENT`;
  const a = parseCalendar(
    wrap(event('RRULE:FREQ=DAILY;COUNT=2') + '\r\n' + moved),
    'a',
    now,
  );
  assert.equal(a.length, 2);
  assert.equal(a[1].start, '2026-09-09T12:00:00.000Z');
  assert.equal(a[1].title, 'Moved');
});
test('all day dates preserve local date and exclusive end', () => {
  const a = parseCalendar(
    wrap(
      `BEGIN:VEVENT\r\nUID:day\r\nDTSTART;VALUE=DATE:20260908\r\nDTEND;VALUE=DATE:20260909\r\nSUMMARY:Day\r\nEND:VEVENT`,
    ),
    'a',
    now,
  );
  assert.equal(a[0].allDay, true);
  assert.equal(a[0].start, '2026-09-08T00:00:00+03:00');
  assert.equal(a[0].end, '2026-09-09T00:00:00+03:00');
});
test('IANA time zone without VTIMEZONE is respected', () => {
  const a = parseCalendar(
    wrap(
      `BEGIN:VEVENT\r\nUID:moscow\r\nDTSTART;TZID=Europe/Moscow:20260908T100000\r\nDTEND;TZID=Europe/Moscow:20260908T110000\r\nSUMMARY:Moscow\r\nEND:VEVENT`,
    ),
    'a',
    now,
  );
  assert.equal(a[0].start, '2026-09-08T07:00:00.000Z');
});
test('invalid, truncated and dense recurrence feeds fail closed', () => {
  assert.throws(() => parseCalendar('not a calendar', 'a', now));
  assert.throws(() => parseCalendar(wrap(event()).slice(0, -6), 'a', now));
  assert.throws(() =>
    parseCalendar(wrap(event('RRULE:FREQ=SECONDLY;COUNT=5')), 'a', now),
  );
  assert.throws(() =>
    parseCalendar(wrap(event().replace('UID:event-1', '')), 'a', now),
  );
});
test('cancelled occurrences are excluded', () => {
  assert.deepEqual(
    parseCalendar(wrap(event('STATUS:CANCELLED')), 'a', now),
    [],
  );
});
test('feed URLs reject local, insecure, credentials, ports and lookalikes', () => {
  for (const u of [
    'http://calendar.google.com/calendar',
    'https://127.0.0.1/x',
    'https://calendar.google.com.evil.test/x',
    'https://user:pass@calendar.google.com/x',
    'https://calendar.google.com:444/x',
    'file:///etc/passwd',
  ])
    assert.throws(() => validateFeedUrl(u));
  assert.equal(
    validateFeedUrl('webcal://calendar.google.com/x'),
    'https://calendar.google.com/x',
  );
});
