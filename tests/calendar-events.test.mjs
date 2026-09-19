import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expandEventSeries,
  eventOnDate,
  isOccurrenceDate,
  validateEventFields,
  validateRepeat,
} from '../lib/calendar-events.ts';
const series = (startDate, repeat, fields = {}) => ({
  id: 'meeting',
  title: 'Meeting',
  notes: '',
  location: '',
  tags: [],
  allDay: false,
  startDate,
  startTime: '10:00',
  durationMinutes: 60,
  repeat,
  exceptions: {},
  ...fields,
});
const dates = (s, from, to) =>
  expandEventSeries([s], from, to).map((e) => e.occurrenceDate);

test('interval cadence is independent of the visible window for every frequency', () => {
  const fixtures = [
    [
      series('2026-01-01', { frequency: 'daily', interval: 3 }),
      ['2026-03-02', '2026-03-05', '2026-03-08'],
    ],
    [
      series('2026-01-05', {
        frequency: 'weekly',
        interval: 2,
        weekdays: [0, 1, 3],
      }),
      ['2026-03-02', '2026-03-04', '2026-03-08'],
    ],
    [
      series('2026-01-05', { frequency: 'monthly', interval: 2 }),
      ['2026-03-05'],
    ],
    [
      series('2022-03-05', { frequency: 'yearly', interval: 2 }),
      ['2026-03-05'],
    ],
  ];
  for (const [s, expected] of fixtures) {
    assert.deepEqual(dates(s, '2026-03-01', '2026-03-10'), expected);
    for (const date of expected) {
      assert.equal(isOccurrenceDate(s, date), true);
      assert.equal(eventOnDate(s, date).start, `${date}T10:00:00+03:00`);
    }
  }
});

test('weekly count respects the partial first week and Monday to Sunday order', () => {
  const s = series('2026-09-09', {
    frequency: 'weekly',
    interval: 2,
    weekdays: [0, 1, 3],
    count: 4,
  });
  assert.deepEqual(dates(s, '2026-09-01', '2026-10-01'), [
    '2026-09-09',
    '2026-09-13',
    '2026-09-21',
    '2026-09-23',
  ]);
  assert.deepEqual(dates(s, '2026-09-22', '2026-10-01'), ['2026-09-23']);
  assert.equal(eventOnDate(s, '2026-09-10'), null);
});

test('monthly dates skip missing days and counts count real events', () => {
  const s = series('2026-01-31', {
    frequency: 'monthly',
    interval: 1,
    monthlyMode: 'date',
    count: 3,
  });
  assert.deepEqual(dates(s, '2026-01-01', '2027-01-01'), [
    '2026-01-31',
    '2026-03-31',
    '2026-05-31',
  ]);
  assert.deepEqual(dates(s, '2026-05-01', '2026-09-01'), ['2026-05-31']);
  const fourthAndLast = series('2026-02-26', {
    frequency: 'monthly',
    interval: 1,
    monthlyMode: 'weekday',
  });
  assert.deepEqual(dates(fourthAndLast, '2026-02-01', '2026-05-01'), [
    '2026-02-26',
    '2026-03-26',
    '2026-04-30',
  ]);
  const third = series('2026-02-19', {
    frequency: 'monthly',
    interval: 1,
    monthlyMode: 'weekday',
  });
  assert.deepEqual(dates(third, '2026-02-01', '2026-05-01'), [
    '2026-02-19',
    '2026-03-19',
    '2026-04-16',
  ]);
});

test('yearly birthdays skip nonleap years and keep their count', () => {
  const leap = series(
    '2024-02-29',
    { frequency: 'yearly', interval: 1, count: 2 },
    { allDay: true, durationMinutes: 1440 },
  );
  assert.deepEqual(dates(leap, '2025-01-01', '2026-01-01'), []);
  assert.deepEqual(dates(leap, '2028-01-01', '2029-01-01'), ['2028-02-29']);
  assert.deepEqual(dates(leap, '2032-01-01', '2033-01-01'), []);
  const birthday = eventOnDate(leap, '2028-02-29');
  assert.equal(birthday.start, '2028-02-29T00:00:00+03:00');
  assert.equal(birthday.end, '2028-02-29T21:00:00.000Z');
  assert.equal(isOccurrenceDate(leap, '2025-02-29'), false);
});

test('until is inclusive; oneoff and boundary dates remain visible', () => {
  const s = series('2026-09-08', {
    frequency: 'daily',
    interval: 1,
    until: '2026-09-10',
  });
  assert.deepEqual(dates(s, '2026-09-08', '2026-09-12'), [
    '2026-09-08',
    '2026-09-09',
    '2026-09-10',
  ]);
  assert.deepEqual(
    dates(
      series('2199-12-31', { frequency: 'none', interval: 1 }),
      '2199-12-31',
      '2200-01-01',
    ),
    ['2199-12-31'],
  );
  assert.deepEqual(
    dates(
      series('1900-01-01', { frequency: 'none', interval: 1 }),
      '1900-01-01',
      '1900-01-02',
    ),
    ['1900-01-01'],
  );
});

test('moved exceptions are filtered by actual overlap, retain original IDs and never duplicate', () => {
  const s = series(
    '2026-09-07',
    { frequency: 'weekly', interval: 1, weekdays: [1] },
    {
      exceptions: {
        '2026-09-07': { startDate: '2026-10-01' },
        '2026-09-14': { cancelled: true },
        '2026-09-21': {
          startDate: '2026-09-07',
          startTime: '11:00',
          title: 'Moved',
        },
        '2026-11-02': { startDate: '2026-09-05', durationMinutes: 4320 },
        '2026-09-10': { startDate: '2026-09-07', title: 'Invalid exception' },
      },
    },
  );
  const result = expandEventSeries([s], '2026-09-07', '2026-09-15');
  assert.deepEqual(
    result.map((e) => e.occurrenceDate),
    ['2026-11-02', '2026-09-21'],
  );
  assert.equal(result[1].id, 'local:meeting:2026-09-21');
  assert.equal(result[1].title, 'Moved');
  assert.equal('exceptions' in result[0], false);
  assert.equal(eventOnDate(s, '2026-09-10'), null);
  assert.equal(eventOnDate(s, '2026-09-14'), null);
});

test('multi-day overlap includes starts before the window and excludes exclusive end', () => {
  const s = series(
    '2026-09-01',
    { frequency: 'none', interval: 1 },
    { allDay: true, durationMinutes: 10080 },
  );
  assert.deepEqual(dates(s, '2026-09-07', '2026-09-08'), ['2026-09-01']);
  assert.deepEqual(dates(s, '2026-09-08', '2026-09-09'), []);
});

test('validation accepts arbitrary timed minutes while keeping all-day day bounds', () => {
  const fields = series('2026-09-08', { frequency: 'none', interval: 1 });
  assert.equal(
    validateEventFields({ ...fields, durationMinutes: 1 }).durationMinutes,
    1,
  );
  assert.equal(
    validateEventFields({ ...fields, durationMinutes: 10080 }).durationMinutes,
    10080,
  );
  assert.equal(
    validateEventFields({ ...fields, durationMinutes: 17 }).durationMinutes,
    17,
  );
  for (const patch of [
    { startDate: '2026-02-30' },
    { startTime: '25:00' },
    { durationMinutes: 0 },
    { allDay: true },
    { tags: ['missing'] },
    { notes: 'x'.repeat(8001) },
    { durationMinutes: 10095 },
    { title: 'x'.repeat(201) },
  ])
    assert.throws(() => validateEventFields({ ...fields, ...patch }));
  for (const durationMinutes of [1440, 10080])
    assert.equal(
      validateEventFields({
        ...fields,
        allDay: true,
        startTime: '00:00',
        durationMinutes,
      }).durationMinutes,
      durationMinutes,
    );
  for (const durationMinutes of [1, 1439, 10081])
    assert.throws(() =>
      validateEventFields({
        ...fields,
        allDay: true,
        startTime: '00:00',
        durationMinutes,
      }),
    );
  assert.deepEqual(
    validateRepeat(
      { frequency: 'monthly', interval: 2, weekdays: [1] },
      fields.startDate,
    ),
    { frequency: 'monthly', interval: 2, monthlyMode: 'date' },
  );
  assert.deepEqual(
    validateRepeat({ frequency: 'weekly', interval: 1 }, fields.startDate)
      .weekdays,
    [2],
  );
  for (const repeat of [
    { frequency: 'weekly', interval: 1, weekdays: [] },
    { frequency: 'yearly', interval: 0 },
    { frequency: 'daily', interval: 1, count: 10001 },
    { frequency: 'daily', interval: 1, until: '2026-09-01' },
    { frequency: 'daily', interval: 1, count: 2, until: '2027-01-01' },
  ])
    assert.throws(() => validateRepeat(repeat, fields.startDate));
  assert.throws(
    () => expandEventSeries([fields], '2026-01-01', '2027-01-03'),
    /366/,
  );
  const dense = Array.from({ length: 100 }, (_, i) => ({
    ...fields,
    id: String(i),
    repeat: { frequency: 'daily', interval: 1 },
  }));
  assert.throws(
    () => expandEventSeries(dense, '2026-09-08', '2027-09-08'),
    /5000/,
  );
});
