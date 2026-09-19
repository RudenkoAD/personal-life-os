import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, initialState } from '../lib/domain.ts';
import {
  buildReviewTree,
  reviewProgress,
  reviewPromptState,
  validateReviewPrompts,
} from '../lib/review-tree.ts';
import { prepareMutation, applyMutation } from '../lib/mutations.ts';

const NOW = new Date('2026-09-08T09:00:00.000Z');
const act = (state, payload) => applyAction(state, payload, 'test', NOW);
const review = (state) => state.reviews.at(-1);

test('nested tree state reports partial groups and toggles whole subtree', () => {
  let state = act(initialState(NOW), {
    type: 'review.create',
    title: 'Nested',
    prompts: [{ title: 'A', children: [{ title: 'a1' }, { title: 'a2' }] }],
  });
  const r = review(state),
    group = r.prompts.find((p) => p.title === 'A');
  assert.deepEqual(reviewProgress(r.prompts), { done: 0, total: 2 });
  state = act(state, {
    type: 'review.prompt',
    id: r.id,
    promptId: r.prompts.find((p) => p.title === 'a1').id,
  });
  assert.equal(
    reviewPromptState(state.reviews.at(-1).prompts, group.id),
    'indeterminate',
  );
  state = act(state, {
    type: 'review.prompt',
    id: r.id,
    promptId: group.id,
    done: true,
  });
  assert.deepEqual(reviewProgress(state.reviews.at(-1).prompts), {
    done: 2,
    total: 2,
  });
});

test('implicit domain toggle checks every leaf in a partial group', () => {
  let state = act(initialState(NOW), {
    type: 'review.create',
    title: 'Nested',
    prompts: [{ title: 'A', children: [{ title: 'a1' }, { title: 'a2' }] }],
  });
  const r = review(state),
    group = r.prompts.find((p) => p.title === 'A');
  state = act(state, {
    type: 'review.prompt',
    id: r.id,
    promptId: r.prompts.find((p) => p.title === 'a1').id,
    done: true,
  });
  state = act(state, { type: 'review.prompt', id: r.id, promptId: group.id });
  assert.equal(reviewProgress(state.reviews.at(-1).prompts).done, 2);
  state = act(state, { type: 'review.prompt', id: r.id, promptId: group.id });
  assert.equal(reviewProgress(state.reviews.at(-1).prompts).done, 0);
});

test('cached parent status follows child add and subtree deletion', () => {
  let state = act(initialState(NOW), {
    type: 'review.create',
    title: 'Nested',
    prompts: [{ title: 'A', children: [{ title: 'a' }] }],
  });
  let r = review(state),
    group = r.prompts.find((p) => p.title === 'A');
  state = act(state, {
    type: 'review.prompt',
    id: r.id,
    promptId: group.id,
    done: true,
  });
  assert.equal(
    state.reviews.at(-1).prompts.find((p) => p.id === group.id).done,
    true,
  );
  state = act(state, {
    type: 'review.prompt',
    id: r.id,
    title: 'new',
    parentId: group.id,
  });
  r = review(state);
  assert.equal(r.prompts.find((p) => p.id === group.id).done, false);
  state = act(state, {
    type: 'review.prompt.delete',
    id: r.id,
    promptId: r.prompts.find((p) => p.title === 'new').id,
  });
  assert.equal(review(state).prompts.find((p) => p.id === group.id).done, true);
});

test('move rejects cycles and invalid beforeId without mutation', () => {
  let state = act(initialState(NOW), {
    type: 'review.create',
    title: 'Nested',
    prompts: [{ title: 'A', children: [{ title: 'a' }] }, { title: 'B' }],
  });
  const r = review(state),
    a = r.prompts.find((p) => p.title === 'A');
  const before = structuredClone(state);
  assert.throws(
    () =>
      act(state, {
        type: 'review.prompt.move',
        id: r.id,
        promptId: a.id,
        parentId: a.prompts,
      }),
    /Родительский/,
  );
  assert.deepEqual(state, before);
  assert.throws(
    () =>
      act(state, {
        type: 'review.prompt.move',
        id: r.id,
        promptId: a.id,
        parentId: null,
        beforeId: 'missing',
      }),
    /Целевой/,
  );
  assert.deepEqual(state, before);
});

test('moving a nested node appends within the target sibling order', () => {
  let state = act(initialState(NOW), {
    type: 'review.create',
    title: 'Nested',
    prompts: [
      { title: 'A', children: [{ title: 'a' }] },
      { title: 'B', children: [{ title: 'b' }] },
      { title: 'C' },
    ],
  });
  const r = review(state);
  const a = r.prompts.find((p) => p.title === 'a');
  const b = r.prompts.find((p) => p.title === 'B');
  state = act(state, {
    type: 'review.prompt.move',
    id: r.id,
    promptId: a.id,
    parentId: b.id,
    beforeId: null,
  });
  assert.deepEqual(
    review(state).prompts.map((p) => p.title),
    ['A', 'B', 'b', 'a', 'C'],
  );
});

test('flat prompts remain compatible, finish resets all nodes, and mutation rebasing is stable', () => {
  let state = initialState(NOW);
  const r = state.reviews[0];
  const p = r.prompts[0];
  const mutation = prepareMutation(state, {
    type: 'review.prompt',
    id: r.id,
    promptId: p.id,
  });
  const projected = applyMutation(state, mutation);
  assert.equal(projected.reviews[0].prompts[0].done, true);
  assert.equal(
    applyMutation(projected, {
      ...mutation,
      action: { ...mutation.action, done: true },
    }).reviews[0].prompts[0].done,
    true,
  );
  state = r.prompts.reduce(
    (s, item) =>
      act(s, {
        type: 'review.prompt',
        id: r.id,
        promptId: item.id,
        done: true,
      }),
    state,
  );
  state = act(state, { type: 'review.finish', id: r.id });
  assert.ok(state.reviews[0].prompts.every((item) => !item.done));
});

test('separator conversion preserves leaf ids and is idempotent', () => {
  let state = initialState(NOW);
  const r = state.reviews[0];
  r.prompts = [
    { id: 'leaf-1', title: 'Area → Task', done: true },
    { id: 'leaf-2', title: 'Area → Other', done: false },
  ];
  state = act(state, {
    type: 'review.update',
    id: r.id,
    nestBySeparator: ' → ',
  });
  const first = structuredClone(state),
    converted = first.reviews[0];
  assert.deepEqual(
    converted.prompts
      .filter((p) => p.id.startsWith('leaf'))
      .map((p) => [p.id, p.title, p.done]),
    [
      ['leaf-1', 'Task', true],
      ['leaf-2', 'Other', false],
    ],
  );
  state = act(state, {
    type: 'review.update',
    id: r.id,
    nestBySeparator: ' → ',
  });
  assert.deepEqual(state.reviews[0].prompts, first.reviews[0].prompts);
});

test('malformed prompt trees are rejected', () => {
  assert.throws(
    () =>
      validateReviewPrompts([
        { id: 'x', title: 'x', done: false, parentId: 'missing' },
      ]),
    /Родительский/,
  );
  assert.throws(
    () =>
      validateReviewPrompts([
        { id: 'x', title: 'x', done: false },
        { id: 'x', title: 'x2', done: false },
      ]),
    /уникальные/,
  );
});
