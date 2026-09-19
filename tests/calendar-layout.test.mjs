import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDayLayout,
  decodeGrabOffset,
  clampResize,
  encodeGrabOffset,
  dayBounds,
  dropInterval,
  pointerTimestamp,
  TRACK_HEIGHT,
  moscowNowPosition,
  selectionInterval,
  selectionIntervalFromTimestamps,
} from '../lib/calendar-layout.ts';
const day = '2026-09-08',
  zero = dayBounds(day).start,
  minute = 60000;
const input = (id, from, to) => ({
  id,
  start: new Date(zero + from * minute).toISOString(),
  end: new Date(zero + to * minute).toISOString(),
  title: id,
  color: '#123456',
  card: true,
});
test('current time line uses Moscow date and pixel position', () => {
  assert.deepEqual(moscowNowPosition(new Date('2026-09-08T20:30:00.000Z')), {
    day: '2026-09-08',
    minutes: 1410,
    top: 1692,
  });
  assert.equal(
    moscowNowPosition(new Date('2026-09-08T20:59:00.000Z')).day,
    '2026-09-08',
  );
  assert.equal(
    moscowNowPosition(new Date('2026-09-08T21:00:00.000Z')).day,
    '2026-09-09',
  );
  assert.equal(moscowNowPosition(new Date('2026-09-08T21:00:00.000Z')).top, 0);
});
test('one proportional block per day, independent overlap group widths and midnight clipping', () => {
  const layout = buildDayLayout(day, [
    input('a', 60, 120),
    input('b', 90, 150),
    input('c', 300, 330),
    input('night', 1430, 1460),
  ]);
  assert.equal(layout.length, 4);
  assert.equal(layout[0].top, 72);
  assert.equal(layout[0].height, 72);
  assert.deepEqual(
    layout.map((x) => x.lanes),
    [2, 2, 1, 1],
  );
  assert.equal(layout[2].lane, 0);
  assert.equal(layout[3].last, false);
  assert.equal(layout[3].height, 12);
  const next = buildDayLayout('2026-09-09', [input('night', 1430, 1460)]);
  assert.equal(next[0].first, false);
  assert.equal(next[0].last, true);
  assert.equal(next[0].top, 0);
  assert.equal(next[0].height, 24);
});
test('resizing snaps absolute time and preserves opposite edge, minimum15m, day and7day bounds', () => {
  const start = zero + 607 * minute,
    end = zero + 667 * minute;
  assert.deepEqual(
    clampResize(
      start,
      end,
      zero + 620 * minute,
      'start',
      zero,
      zero + 1440 * minute,
    ),
    { start: zero + 615 * minute, end },
  );
  assert.equal(
    clampResize(
      start,
      end,
      zero + 800 * minute,
      'start',
      zero,
      zero + 1440 * minute,
    ).start,
    zero + 645 * minute,
  );
  assert.equal(
    clampResize(
      start,
      end,
      zero + 300 * minute,
      'end',
      zero,
      zero + 1440 * minute,
    ).end,
    zero + 630 * minute,
  );
  assert.equal(
    clampResize(start, end, zero - 90000, 'start', zero, zero + 1440 * minute)
      .start,
    zero,
  );
  assert.equal(
    clampResize(
      start,
      end,
      zero + 1500 * minute,
      'end',
      zero,
      zero + 1440 * minute,
    ).end,
    zero + 1440 * minute,
  );
  assert.ok(
    clampResize(start, end, zero - 20 * 86400000, 'start').start >=
      end - 7 * 86400000,
  );
  assert.ok(
    clampResize(start, end, zero + 20 * 86400000, 'end').end <=
      start + 7 * 86400000,
  );
});
test('pointer mapping follows scrolling and drops at23:45 rather than23:59 while preservingduration', () => {
  assert.equal(pointerTimestamp(day, 100, -620), zero + 600 * minute);
  assert.equal(pointerTimestamp(day, 100, -638), zero + 615 * minute);
  const interval = dropInterval(
    day,
    TRACK_HEIGHT + 50,
    0,
    TRACK_HEIGHT,
    90 * minute,
  );
  assert.equal(interval.start, zero + 1425 * minute);
  assert.equal(interval.end - interval.start, 90 * minute);
  assert.equal(dropInterval(day, -100, 0).start, zero);
});

test('empty-track selection snaps forward and enforces a 15-minute minimum', () => {
  const range = selectionInterval(day, 607, 652, 0, TRACK_HEIGHT);
  assert.equal(range.start, zero + 8 * 60 * minute + 30 * minute);
  assert.equal(range.end, zero + 9 * 60 * minute);
  const minimum = selectionInterval(day, 100, 101, 0, TRACK_HEIGHT);
  assert.equal(minimum.end - minimum.start, 15 * minute);
});

test('empty-track selection handles reverse drags and clamps outside midnight', () => {
  const range = selectionInterval(day, 652, 607, 0, TRACK_HEIGHT);
  assert.equal(range.start, zero + 8 * 60 * minute + 30 * minute);
  assert.equal(range.end, zero + 9 * 60 * minute);
  const late = selectionInterval(day, TRACK_HEIGHT + 300, TRACK_HEIGHT + 301, 0);
  assert.equal(late.end, dayBounds(day).end);
  assert.equal(late.end - late.start, 15 * minute);
});

test('selection anchor stays fixed while the scrolled endpoint follows track geometry', () => {
  const anchor = pointerTimestamp(day, 100, -620);
  const endAfterScroll = pointerTimestamp(day, 190, -692);
  const range = selectionIntervalFromTimestamps(day, anchor, endAfterScroll);
  assert.equal(range.start, zero + 600 * minute);
  assert.equal(range.end, zero + 735 * minute);
  const top = selectionInterval(day, 30, -200, 0);
  assert.equal(top.start, zero);
  assert.equal(top.end, zero + 30 * minute);
});

test('calendar body drop preserves grabbed position and snaps the real start to15 minutes', () => {
  const originalStart = zero + 9 * 60 * minute + 7 * minute;
  const pointer = zero + 10 * 60 * minute + 22 * minute;
  const offset = pointer - originalStart;
  const interval = dropInterval(
    day,
    ((10 * 60 + 22) / 1440) * TRACK_HEIGHT,
    0,
    TRACK_HEIGHT,
    90 * minute,
    offset,
  );
  assert.equal(interval.start, zero + 9 * 60 * minute);
  assert.equal(interval.end - interval.start, 90 * minute);
});

test('grab offset is computed against an actual start when a continuation is clipped at midnight', () => {
  const previous = dayBounds(day).start + 23 * 60 * minute;
  const nextDay = '2026-09-09';
  const nextStart = dayBounds(nextDay).start;
  const pointer = nextStart + 30 * minute;
  const interval = dropInterval(
    day,
    12 * 72,
    0,
    TRACK_HEIGHT,
    2 * 60 * minute,
    pointer - previous,
  );
  assert.equal(interval.start, zero + 10 * 60 * minute + 30 * minute);
});

test('moving a clipped continuation to the same time on the next day keeps its absolute start before midnight', () => {
  const sourceStart = dayBounds(day).start + 23 * 60 * minute;
  const destination = '2026-09-09';
  const pointer = dayBounds(destination).start + 30 * minute;
  const interval = dropInterval(
    destination,
    (30 / 1440) * TRACK_HEIGHT,
    0,
    TRACK_HEIGHT,
    2 * 60 * minute,
    pointer - sourceStart,
  );
  assert.equal(interval.start, sourceStart);
  assert.equal(interval.end - interval.start, 2 * 60 * minute);
});

test('malformed or hostile drag metadata falls back to zero and remains bounded', () => {
  assert.equal(decodeGrabOffset('{bad'), 0);
  assert.equal(
    decodeGrabOffset(
      '{"version":2,"origin":"calendar","grabOffsetMs":3600000}',
    ),
    0,
  );
  assert.equal(
    decodeGrabOffset('{"version":1,"origin":"board","grabOffsetMs":3600000}'),
    0,
  );
  assert.equal(decodeGrabOffset('{"grabOffsetMs":"20"}'), 0);
  assert.equal(decodeGrabOffset('{"grabOffsetMs":null}'), 0);
  assert.equal(decodeGrabOffset(encodeGrabOffset(Infinity)), 0);
  assert.equal(decodeGrabOffset('x'.repeat(257)), 0);
  assert.ok(decodeGrabOffset('{"grabOffsetMs":999999999999}') <= 31 * 86400000);
});
