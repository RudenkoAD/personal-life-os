import test from 'node:test';
import assert from 'node:assert/strict';

const { initialState, applyAction } = await import('../lib/domain.ts');
const { materializeEventTasks, setEventTaskRules } =
  await import('../lib/event-tasks.ts');

const at = (value) => new Date(`${value}Z`);
let sequence = 0;
const makeId = () => `event-task-test-${++sequence}`;

function createEvent(action, now = at('2026-09-01T00:00:00.000')) {
  return applyAction(
    initialState(now),
    { type: 'event.create', ...action },
    'test',
    now,
    makeId,
  );
}

function rule(id, title, minutesBefore, extra = {}) {
  return { id, title, notes: '', minutesBefore, ...extra };
}

function withRules(state, seriesId, rules) {
  state.eventTaskRules[`series:${seriesId}`] = rules;
  return state;
}

test('materializes a timed conference preparation task exactly at its due instant', () => {
  const state = createEvent({
    title: 'Конференция',
    startDate: '2026-09-14',
    startTime: '10:00',
  });
  const id = state.calendarSeries[0].id;
  withRules(state, id, [
    rule('prep', 'Подготовиться', 24 * 60, {
      createdAt: '2026-09-01T00:00:00.000Z',
    }),
  ]);

  const before = materializeEventTasks(state, at('2026-09-13T06:59:59.000'));
  assert.equal(before.cards.length, 0);
  const due = materializeEventTasks(state, at('2026-09-13T07:00:00.000'));
  assert.equal(due.cards.length, 1);
  assert.equal(due.cards[0].title, 'Подготовиться');
  assert.equal(Object.keys(due.eventTaskRuns).length, 1);
});

test('all-day event uses 09:00 Moscow as its preparation anchor', () => {
  const state = createEvent({
    title: 'Праздник',
    startDate: '2026-09-14',
    allDay: true,
  });
  const id = state.calendarSeries[0].id;
  withRules(state, id, [
    rule('prep', 'Проверить подарок', 0, {
      createdAt: '2026-09-01T00:00:00.000Z',
    }),
  ]);
  assert.equal(
    materializeEventTasks(state, at('2026-09-14T05:59:59.000')).cards.length,
    0,
  );
  assert.equal(
    materializeEventTasks(state, at('2026-09-14T06:00:00.000')).cards.length,
    1,
  );
});

test('recurring series materializes each occurrence as it becomes due and remains idempotent', () => {
  const state = createEvent({
    title: 'Еженедельная встреча',
    startDate: '2026-09-07',
    startTime: '10:00',
    repeat: { frequency: 'weekly', interval: 1, weekdays: [1] },
  });
  const id = state.calendarSeries[0].id;
  withRules(state, id, [
    rule('prep', 'Подготовиться', 0, { createdAt: '2026-09-01T00:00:00.000Z' }),
  ]);
  let projected = state;
  for (const day of ['2026-09-07', '2026-09-14', '2026-09-21']) {
    projected = materializeEventTasks(projected, at(`${day}T07:00:00.000`));
  }
  assert.equal(projected.cards.length, 3);
  const twice = materializeEventTasks(projected, at('2026-09-21T07:00:00.000'));
  assert.equal(twice.cards.length, 3);
  assert.equal(twice.revision, projected.revision);
});

test('birthday preset with an old date creates the current year gift task', () => {
  const state = applyAction(
    initialState(at('2026-01-01T00:00:00.000')),
    {
      type: 'event.create',
      startDate: '1990-02-28',
      birthday: { name: 'Лена' },
    },
    'test',
    at('2026-01-01T00:00:00.000'),
    makeId,
  );
  const materialized = materializeEventTasks(
    state,
    at('2026-02-21T06:00:00.000'),
  );
  assert.equal(materialized.cards.length, 1);
  assert.match(materialized.cards[0].title, /Лена/);
});

test('cancelled occurrences and deleted series never create event tasks', () => {
  let state = createEvent({
    title: 'Отменяемая',
    startDate: '2026-09-14',
    repeat: { frequency: 'weekly', interval: 1, weekdays: [1] },
  });
  const id = state.calendarSeries[0].id;
  withRules(state, id, [
    rule('prep', 'Не создавать', 0, { createdAt: '2026-09-01T00:00:00.000Z' }),
  ]);
  state = applyAction(
    state,
    {
      type: 'event.override',
      id,
      occurrenceDate: '2026-09-14',
      cancelled: true,
    },
    'test',
    at('2026-09-01T00:00:00.000'),
    makeId,
  );
  assert.equal(
    materializeEventTasks(state, at('2026-09-14T07:00:00.000')).cards.length,
    0,
  );
  state = applyAction(
    state,
    { type: 'event.delete', id },
    'test',
    at('2026-09-01T00:00:00.000'),
    makeId,
  );
  assert.equal(Object.keys(state.eventTaskRules).length, 0);
});

test('editing rules preserves server metadata when it is unchanged', () => {
  const state = createEvent({ title: 'Событие', startDate: '2026-09-14' });
  const id = state.calendarSeries[0].id;
  const original = {
    id: 'prep',
    title: 'Старое',
    notes: '',
    minutesBefore: 60,
    createdAt: '2026-09-01T00:00:00.000Z',
    catchUpOccurrence: '2026-09-14',
  };
  state.eventTaskRules[`series:${id}`] = [original];
  setEventTaskRules(
    state,
    {
      target: { kind: 'series', id },
      rules: [{ ...original, title: 'Новое' }],
    },
    at('2026-09-02T00:00:00.000'),
  );
  assert.equal(
    state.eventTaskRules[`series:${id}`][0].createdAt,
    original.createdAt,
  );
  assert.equal(
    state.eventTaskRules[`series:${id}`][0].catchUpOccurrence,
    original.catchUpOccurrence,
  );
});

test('long lead times do not dump an unbounded recurrence backlog', () => {
  const state = createEvent({
    title: 'Ежедневное',
    startDate: '2026-01-01',
    startTime: '10:00',
    repeat: { frequency: 'daily', interval: 1 },
  });
  const id = state.calendarSeries[0].id;
  const createdAt = at('2026-09-13T07:00:00.000');
  setEventTaskRules(
    state,
    {
      target: { kind: 'series', id },
      rules: [rule('lead', 'Длинная подготовка', 525600)],
    },
    createdAt,
  );
  const materialized = materializeEventTasks(
    state,
    at('2026-09-13T07:01:00.000'),
  );
  assert.ok(
    materialized.cards.length <= 2,
    `unexpected backlog: ${materialized.cards.length}`,
  );
});

test('card and serialized byte limits do not advance event task ledger', () => {
  const state = createEvent({ title: 'Лимит', startDate: '2026-09-14' });
  const id = state.calendarSeries[0].id;
  withRules(state, id, [
    rule('limit', 'Лимит', 0, { createdAt: '2026-09-01T00:00:00.000Z' }),
  ]);
  state.cards = Array.from({ length: 2000 }, (_, i) => ({
    id: `card-${i}`,
    title: 'x',
    notes: '',
    type: 'task',
    placement: 'inbox',
    boardId: 'main',
    columnId: 'x',
    tags: [],
    steps: [],
    done: false,
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  }));
  const capped = materializeEventTasks(state, at('2026-09-14T07:00:00.000'));
  assert.equal(capped, state);
  assert.deepEqual(capped.eventTaskRuns, {});

  const bytes = createEvent({ title: 'Размер', startDate: '2026-09-14' });
  const bytesId = bytes.calendarSeries[0].id;
  withRules(bytes, bytesId, [
    rule('bytes', 'Размер', 0, { createdAt: '2026-09-01T00:00:00.000Z' }),
  ]);
  bytes.cards = Array.from({ length: 1999 }, (_, i) => ({
    id: `large-${i}`,
    title: 'x'.repeat(1000),
    notes: '',
    type: 'task',
    placement: 'inbox',
    boardId: 'main',
    columnId: 'x',
    tags: [],
    steps: [],
    done: false,
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  }));
  const oversized = materializeEventTasks(bytes, at('2026-09-14T06:00:00.000'));
  assert.equal(oversized, bytes);
  assert.deepEqual(oversized.eventTaskRuns, {});
});

test('different rule IDs cannot collide after generated card ID sanitization', () => {
  const state = createEvent({ title: 'Коллизия', startDate: '2026-09-14' });
  const id = state.calendarSeries[0].id;
  withRules(state, id, [
    rule('a/b', 'Первое', 0, { createdAt: '2026-09-01T00:00:00.000Z' }),
    rule('a_b', 'Второе', 0, { createdAt: '2026-09-01T00:00:00.000Z' }),
  ]);
  const materialized = materializeEventTasks(
    state,
    at('2026-09-14T06:00:00.000'),
  );
  assert.equal(materialized.cards.length, 2);
  assert.equal(new Set(materialized.cards.map((card) => card.id)).size, 2);
});

test('materializes rules for external events and scheduled cards', () => {
  const state = initialState(at('2026-09-01T00:00:00.000'));
  state.events.push({
    id: 'external-1',
    sourceId: 'source-1',
    uid: 'u1',
    title: 'Внешняя встреча',
    start: '2026-09-14T07:00:00.000Z',
    end: '2026-09-14T08:00:00.000Z',
    allDay: false,
    tags: [],
    location: '',
  });
  state.cards.push({
    id: 'scheduled-1',
    title: 'Запланированная карточка',
    notes: '',
    type: 'task',
    placement: 'calendar',
    boardId: 'main',
    columnId: 'x',
    tags: [],
    steps: [],
    done: false,
    archived: false,
    start: '2026-09-14T07:00:00.000Z',
    end: '2026-09-14T08:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
  });
  state.eventTaskRules['external:external-1'] = [
    rule('external', 'Подготовить внешнюю встречу', 0, {
      createdAt: '2026-09-01T00:00:00.000Z',
    }),
  ];
  state.eventTaskRules['card:scheduled-1'] = [
    rule('card', 'Подготовить карточку', 0, {
      createdAt: '2026-09-01T00:00:00.000Z',
    }),
  ];
  const materialized = materializeEventTasks(
    state,
    at('2026-09-14T07:00:00.000'),
  );
  assert.deepEqual(
    materialized.cards
      .filter((card) => card.id.startsWith('et_'))
      .map((card) => card.title)
      .sort(),
    ['Подготовить внешнюю встречу', 'Подготовить карточку'].sort(),
  );
});

test('external all-day event uses 09:00 Moscow anchor', () => {
  const state = initialState(at('2026-09-01T00:00:00.000'));
  state.events.push({
    id: 'external-all-day',
    sourceId: 'source-1',
    uid: 'u2',
    title: 'Весь день',
    start: '2026-09-14T00:00:00.000Z',
    end: '2026-09-15T00:00:00.000Z',
    allDay: true,
    tags: [],
    location: '',
  });
  state.eventTaskRules['external:external-all-day'] = [
    rule('prep', 'Подготовить весь день', 0, {
      createdAt: '2026-09-01T00:00:00.000Z',
    }),
  ];
  const before = materializeEventTasks(state, at('2026-09-14T05:59:59.000'));
  assert.equal(
    before.cards.filter((card) => card.id.startsWith('et_')).length,
    0,
  );
  const due = materializeEventTasks(state, at('2026-09-14T06:00:00.000'));
  assert.equal(due.cards.filter((card) => card.id.startsWith('et_')).length, 1);
});

test('completed or moved scheduled cards do not generate event tasks', () => {
  const state = initialState(at('2026-09-01T00:00:00.000'));
  state.cards.push({
    id: 'completed-card',
    title: 'Done',
    notes: '',
    type: 'task',
    placement: 'calendar',
    boardId: 'main',
    columnId: 'x',
    tags: [],
    steps: [],
    done: true,
    archived: true,
    start: '2026-09-14T07:00:00.000Z',
    end: '2026-09-14T08:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
  });
  state.cards.push({
    id: 'moved-card',
    title: 'Moved',
    notes: '',
    type: 'task',
    placement: 'inbox',
    boardId: 'main',
    columnId: 'x',
    tags: [],
    steps: [],
    done: false,
    archived: false,
    start: '2026-09-14T07:00:00.000Z',
    end: '2026-09-14T08:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
  });
  state.eventTaskRules['card:completed-card'] = [
    rule('done', 'Не создавать done', 0, {
      createdAt: '2026-09-01T00:00:00.000Z',
    }),
  ];
  state.eventTaskRules['card:moved-card'] = [
    rule('moved', 'Не создавать moved', 0, {
      createdAt: '2026-09-01T00:00:00.000Z',
    }),
  ];
  const projected = materializeEventTasks(state, at('2026-09-14T07:00:00.000'));
  assert.equal(
    projected.cards.filter((card) => card.id.startsWith('et_')).length,
    0,
  );
});

test('multiday event started before now still materializes while it is active', () => {
  const state = createEvent({
    title: 'Длинное событие',
    startDate: '2026-09-13',
    startTime: '09:00',
    durationMinutes: 1440 * 2,
  });
  const id = state.calendarSeries[0].id;
  withRules(state, id, [
    rule('during', 'Задача во время события', 0, {
      createdAt: '2026-09-01T00:00:00.000Z',
    }),
  ]);
  const materialized = materializeEventTasks(
    state,
    at('2026-09-14T08:00:00.000'),
  );
  assert.equal(
    materialized.cards.filter((card) => card.id.startsWith('et_')).length,
    1,
  );
});

test('occurrence rules override series rules for that occurrence', () => {
  const state = createEvent({
    title: 'Серия',
    startDate: '2026-09-14',
    repeat: { frequency: 'weekly', interval: 1, weekdays: [1] },
  });
  const id = state.calendarSeries[0].id;
  withRules(state, id, [
    rule('series-rule', 'Обычная подготовка', 0, {
      createdAt: '2026-09-01T00:00:00.000Z',
    }),
  ]);
  state.eventTaskRules[`occurrence:${id}:2026-09-14`] = [
    rule('occurrence-rule', 'Особая подготовка', 0, {
      createdAt: '2026-09-01T00:00:00.000Z',
    }),
  ];
  const materialized = materializeEventTasks(
    state,
    at('2026-09-14T06:00:00.000'),
  );
  assert.deepEqual(
    materialized.cards.map((card) => card.title),
    ['Особая подготовка'],
  );
});

test('task rule targets reject invalid occurrences and enforce field limits', () => {
  const state = createEvent({
    title: 'Серия',
    startDate: '2026-09-14',
    repeat: { frequency: 'weekly', interval: 1, weekdays: [1] },
  });
  const id = state.calendarSeries[0].id;
  assert.throws(
    () =>
      setEventTaskRules(state, {
        target: { kind: 'occurrence', id, occurrenceDate: '2026-09-15' },
        rules: [],
      }),
    /Повтор не найден/,
  );
  assert.throws(
    () =>
      setEventTaskRules(state, {
        target: { kind: 'series', id },
        rules: [rule('bad', 'x'.repeat(201), 0)],
      }),
    /название|названи|200/,
  );
  assert.throws(
    () =>
      setEventTaskRules(state, {
        target: { kind: 'series', id },
        rules: [rule('bad', 'ok', 0, { notes: 'x'.repeat(8001) })],
      }),
    /замет|8000/,
  );
  assert.throws(
    () =>
      setEventTaskRules(state, { target: { kind: 'series', id }, rules: null }),
    Error,
  );
  assert.throws(
    () =>
      setEventTaskRules(state, {
        target: { kind: 'series', id },
        rules: [null],
      }),
    Error,
  );
});

test('adding a rule inside its lead window catches up once even after task deletion', () => {
  const now = at('2026-09-13T08:00:00.000');
  const state = createEvent({
    title: 'Конференция',
    startDate: '2026-09-14',
    startTime: '10:00',
  });
  const id = state.calendarSeries[0].id;
  setEventTaskRules(
    state,
    {
      target: { kind: 'series', id },
      rules: [rule('prep', 'Подготовиться', 1440)],
    },
    now,
  );
  assert.equal(
    state.eventTaskRules[`series:${id}`][0].catchUpOccurrence,
    '2026-09-14',
  );
  const generated = materializeEventTasks(state, now);
  assert.equal(generated.cards.length, 1);
  generated.cards = [];
  assert.equal(
    materializeEventTasks(generated, at('2026-09-13T09:00:00.000')).cards
      .length,
    0,
  );
});

test('moved occurrence uses its effective all-day date and shares receipts with series rules', () => {
  let state = createEvent({
    title: 'Встреча',
    startDate: '2026-09-07',
    allDay: true,
    repeat: { frequency: 'weekly', interval: 1, weekdays: [1] },
  });
  const id = state.calendarSeries[0].id;
  state = applyAction(
    state,
    {
      type: 'event.override',
      id,
      occurrenceDate: '2026-09-14',
      patch: { startDate: '2026-09-18' },
    },
    'test',
    at('2026-09-01T00:00:00.000'),
    makeId,
  );
  const item = rule('prep', 'Подготовиться', 0, {
    createdAt: '2026-09-01T00:00:00.000Z',
  });
  withRules(state, id, [item]);
  assert.equal(
    materializeEventTasks(state, at('2026-09-18T05:59:59.000')).cards.length,
    0,
  );
  const generated = materializeEventTasks(state, at('2026-09-18T06:00:00.000'));
  assert.equal(generated.cards.length, 1);
  generated.eventTaskRules[`occurrence:${id}:2026-09-14`] = [
    { ...item, title: 'Изменённое' },
  ];
  assert.equal(
    materializeEventTasks(generated, at('2026-09-18T06:00:01.000')).cards
      .length,
    1,
  );
  const onlyOccurrence = structuredClone(state);
  onlyOccurrence.eventTaskRules = { [`occurrence:${id}:2026-09-14`]: [item] };
  assert.equal(
    materializeEventTasks(onlyOccurrence, at('2026-09-18T06:00:00.000')).cards
      .length,
    1,
  );
});
