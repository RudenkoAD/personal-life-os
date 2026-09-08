import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDayLayout,
  clampResize,
  dayBounds,
  dropInterval,
  pointerTimestamp,
  TRACK_HEIGHT,
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
