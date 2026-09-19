import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewPromptTree } from '../components/review-prompt-tree';
import type { Review } from '../lib/domain';

const baseReview = (prompts: Review['prompts']): Review => ({
  id: 'review-1',
  title: 'Weekly review',
  prompts,
  intervalDays: 7,
  nextDue: '2099-01-01',
  notes: '',
  history: [],
});

void test('renders a large nested review with hierarchy and partial checkbox state', () => {
  const prompts: Review['prompts'] = [
    { id: 'root', title: 'Plan the week', done: false, parentId: null },
    { id: 'work', title: 'Work', done: false, parentId: 'root' },
    { id: 'one', title: 'Prepare report', done: true, parentId: 'work' },
    { id: 'two', title: 'Book review meeting', done: false, parentId: 'work' },
  ];
  for (let i = 0; i < 296; i++)
    prompts.push({
      id: `leaf-${i}`,
      title: `Leaf ${i}`,
      done: i % 2 === 0,
      parentId: null,
    });
  const markup = renderToStaticMarkup(
    React.createElement(ReviewPromptTree, {
      review: baseReview(prompts),
      pending: false,
      act: async () => true,
      capturePrompt: () => {},
    }),
  );
  assert.match(markup, /Plan the week/);
  assert.match(markup, /Prepare report/);
  assert.match(markup, /style="--depth:2"/);
  assert.match(markup, /data-state="indeterminate"/);
  assert.match(markup, /aria-checked="mixed"/);
  assert.match(markup, /149 из 298 пунктов/);
  assert.match(markup, /Раскрыть всё/);
});

void test('keeps flat prompts renderable with leaf progress and capture controls', () => {
  const review = baseReview([
    { id: 'a', title: 'Inbox', done: false },
    { id: 'b', title: 'Calendar', done: true },
  ]);
  const markup = renderToStaticMarkup(
    React.createElement(ReviewPromptTree, {
      review,
      pending: false,
      act: async () => true,
      capturePrompt: () => {},
    }),
  );
  assert.match(markup, /Inbox/);
  assert.match(markup, /Calendar/);
  assert.match(markup, /1 из 2 пунктов/);
  assert.match(markup, /Создать дело/);
});
