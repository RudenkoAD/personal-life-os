import test from 'node:test';
import assert from 'node:assert/strict';

import { DomainError, applyAction, initialState } from '../lib/domain.ts';

const NOW = new Date('2026-09-08T09:00:00.000Z');

function action(state, payload) {
  return applyAction(state, payload, 'domain-test', NOW);
}

function createCard(state, title, cardType = 'task', extra = {}) {
  return action(state, { type: 'create', title, cardType, ...extra });
}

function lastCard(state, title) {
  return state.cards.find((card) => card.title === title);
}

function assertDomainError(fn, message) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof DomainError);
    if (message) assert.match(error.message, message);
    return true;
  });
}

test('schedule then return to board preserves card identity and content', () => {
  let state = initialState(NOW);
  state = createCard(state, 'Позвонить электрику', 'task', {
    notes: 'Найти номер в договоре',
    tags: ['life'],
  });
  const beforeSchedule = lastCard(state, 'Позвонить электрику');
  const original = structuredClone(beforeSchedule);

  state = action(state, {
    type: 'schedule',
    id: beforeSchedule.id,
    start: '2026-09-10T10:00:00+03:00',
    end: '2026-09-10T11:00:00+03:00',
  });
  const scheduled = state.cards.find((card) => card.id === original.id);
  assert.equal(scheduled.id, original.id);
  assert.equal(scheduled.title, original.title);
  assert.equal(scheduled.notes, original.notes);
  assert.deepEqual(scheduled.tags, original.tags);
  assert.equal(scheduled.placement, 'calendar');
  assert.ok(scheduled.start && scheduled.end);

  state = action(state, {
    type: 'move',
    id: original.id,
    boardId: 'main',
  });
  const returned = state.cards.find((card) => card.id === original.id);
  assert.equal(returned.id, original.id);
  assert.equal(returned.title, original.title);
  assert.equal(returned.notes, original.notes);
  assert.deepEqual(returned.tags, original.tags);
  assert.equal(returned.placement, 'board');
  assert.equal('start' in returned, false);
  assert.equal('end' in returned, false);
});

test('invalid moves and schedules are atomic', () => {
  let state = initialState(NOW);
  state = createCard(state, 'Атомарность', 'task');
  const card = lastCard(state, 'Атомарность');
  state = action(state, {
    type: 'schedule',
    id: card.id,
    start: '2026-09-10T10:00:00Z',
    end: '2026-09-10T11:00:00Z',
  });
  const snapshot = structuredClone(state);

  assertDomainError(
    () =>
      action(state, { type: 'move', id: card.id, boardId: 'missing-board' }),
    /Доска не найдена/,
  );
  assert.deepEqual(state, snapshot);

  assertDomainError(
    () =>
      action(state, {
        type: 'schedule',
        id: card.id,
        start: '2026-09-10T11:00:00Z',
        end: '2026-09-10T10:00:00Z',
      }),
    /корректное время/,
  );
  assert.deepEqual(state, snapshot);

  assertDomainError(
    () =>
      action(state, {
        type: 'schedule',
        id: card.id,
        start: '2026-09-10T10:00:00Z',
        end: '2026-09-18T10:00:01Z',
      }),
    /до 7 дней/,
  );
  assert.deepEqual(state, snapshot);
});

test('nested project cycle is rejected', () => {
  let state = initialState(NOW);
  state = createCard(state, 'Родитель', 'project');
  const parent = lastCard(state, 'Родитель');
  state = createCard(state, 'Потомок', 'project', {
    boardId: parent.childBoardId,
  });
  const child = lastCard(state, 'Потомок');
  const snapshot = structuredClone(state);

  assertDomainError(
    () =>
      action(state, {
        type: 'move',
        id: parent.id,
        boardId: child.childBoardId,
      }),
    /Нельзя переместить проект внутрь самого себя/,
  );
  assert.deepEqual(state, snapshot);
});

test('foreign card and board IDs cannot cross state boundaries', () => {
  let first = initialState(NOW);
  first = createCard(first, 'Чужая карточка', 'task');
  const foreign = lastCard(first, 'Чужая карточка');

  const second = initialState(NOW);
  const snapshot = structuredClone(second);
  assertDomainError(
    () => action(second, { type: 'move', id: foreign.id, boardId: 'main' }),
    /Карточка не найдена/,
  );
  assert.deepEqual(second, snapshot);

  let firstProject = initialState(NOW);
  firstProject = createCard(firstProject, 'Чужой проект', 'project');
  const foreignBoard = lastCard(firstProject, 'Чужой проект').childBoardId;
  assertDomainError(
    () =>
      action(second, {
        type: 'create',
        title: 'Смешанная доска',
        boardId: foreignBoard,
      }),
    /Доска не найдена/,
  );
});

test('review cannot finish before every prompt is done, then resets for next run', () => {
  let state = initialState(NOW);
  const review = state.reviews[0];
  const snapshot = structuredClone(state);

  assertDomainError(
    () => action(state, { type: 'review.finish', id: review.id }),
    /Сначала пройдите все пункты/,
  );
  assert.deepEqual(state, snapshot);

  for (const prompt of review.prompts) {
    state = action(state, {
      type: 'review.prompt',
      id: review.id,
      promptId: prompt.id,
    });
  }
  state = action(state, { type: 'review.finish', id: review.id });
  const finished = state.reviews.find((item) => item.id === review.id);
  assert.equal(finished.history.length, 1);
  assert.equal(
    finished.prompts.every((prompt) => !prompt.done),
    true,
  );
  assert.equal(finished.nextDue, '2026-10-08');
  assert.equal(finished.notes, '');
});

test('tags reject unknown values and duplicate tag names', () => {
  let state = initialState(NOW);
  const snapshot = structuredClone(state);

  assertDomainError(
    () =>
      action(state, {
        type: 'create',
        title: 'Неверный тег',
        tags: ['missing'],
      }),
    /Неизвестный тег/,
  );
  assert.deepEqual(state, snapshot);

  assertDomainError(
    () => action(state, { type: 'tag.create', title: ' жизнь ' }),
    /Такой тег уже есть/,
  );
  assert.deepEqual(state, snapshot);

  state = action(state, {
    type: 'create',
    title: 'Дедупликация тегов',
    tags: ['life', 'life'],
  });
  assert.deepEqual(lastCard(state, 'Дедупликация тегов').tags, ['life']);
});

test('sequence steps support add, toggle, delete, and reject non-sequence cards', () => {
  let state = initialState(NOW);
  state = createCard(state, 'Вызвать электрика', 'sequence');
  const sequence = lastCard(state, 'Вызвать электрика');

  assertDomainError(
    () => action(state, { type: 'step.add', id: sequence.id, title: '   ' }),
    /Шаг: от 1 до 200 символов/,
  );
  assert.equal(sequence.steps.length, 0);

  state = action(state, {
    type: 'step.add',
    id: sequence.id,
    title: 'Позвонить',
  });
  state = action(state, {
    type: 'step.add',
    id: sequence.id,
    title: 'Договориться о времени',
  });
  const withSteps = lastCard(state, 'Вызвать электрика');
  const firstStep = withSteps.steps[0];
  const secondStep = withSteps.steps[1];

  state = action(state, {
    type: 'step.toggle',
    id: sequence.id,
    stepId: firstStep.id,
  });
  assert.equal(lastCard(state, 'Вызвать электрика').steps[0].done, true);
  state = action(state, {
    type: 'step.delete',
    id: sequence.id,
    stepId: secondStep.id,
  });
  assert.deepEqual(
    lastCard(state, 'Вызвать электрика').steps.map((step) => step.title),
    ['Позвонить'],
  );

  state = createCard(state, 'Обычная задача', 'task');
  const taskCard = lastCard(state, 'Обычная задача');
  assertDomainError(
    () =>
      action(state, {
        type: 'step.add',
        id: taskCard.id,
        title: 'Недопустимый шаг',
      }),
    /Шаги доступны в последовательности/,
  );
});
