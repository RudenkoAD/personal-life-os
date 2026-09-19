import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, initialState, DomainError } from '../lib/domain.ts';
const now = new Date('2026-09-13T09:00:00Z');
const act = (state, payload) => applyAction(state, payload, 'fixture', now);
function fixture() {
  const s = initialState(now);
  s.boards[0].columns = [
    { id: 'a', title: 'A', color: '#ff0000' },
    { id: 'b', title: 'B' },
    { id: 'c', title: 'C' },
  ];
  s.boards.push({
    id: 'other',
    title: 'Other',
    columns: [{ id: 'foreign', title: 'Foreign' }],
  });
  return act(s, {
    type: 'create',
    title: 'Task',
    boardId: 'main',
    columnId: 'b',
  });
}
test('column moves preserve content, cards and other boards; repeated relative moves are stable', () => {
  const s = fixture(),
    original = structuredClone(s);
  const moved = act(s, {
    type: 'column.move',
    boardId: 'main',
    id: 'c',
    beforeId: 'a',
  });
  assert.deepEqual(
    moved.boards[0].columns.map((c) => c.id),
    ['c', 'a', 'b'],
  );
  assert.deepEqual(moved.cards, s.cards);
  assert.deepEqual(moved.boards[1], s.boards[1]);
  assert.deepEqual(s, original);
  const twice = act(moved, {
    type: 'column.move',
    boardId: 'main',
    id: 'c',
    beforeId: 'a',
  });
  assert.deepEqual(twice.boards, moved.boards);
  const end = act(moved, {
    type: 'column.move',
    boardId: 'main',
    id: 'a',
    beforeId: null,
  });
  assert.deepEqual(
    end.boards[0].columns.map((c) => c.id),
    ['c', 'b', 'a'],
  );
  assert.equal(end.boards[0].columns[2].color, '#ff0000');
  assert.deepEqual(
    act(end, { type: 'column.move', boardId: 'main', id: 'a', beforeId: 'a' })
      .boards,
    end.boards,
  );
});
test('relative moves keep columns added during an optimistic action rebase', () => {
  const s = fixture();
  const concurrent = act(s, {
    type: 'column.add',
    boardId: 'main',
    title: 'Added concurrently',
  });
  const result = act(concurrent, {
    type: 'column.move',
    boardId: 'main',
    id: 'b',
    beforeId: 'a',
  });
  assert.deepEqual(
    result.boards[0].columns.slice(0, 3).map((c) => c.id),
    ['b', 'a', 'c'],
  );
  assert.equal(result.boards[0].columns[3].title, 'Added concurrently');
});
test('column color is persisted independently and reset restores an unset value', () => {
  const s = fixture();
  const colored = act(s, {
    type: 'column.color',
    boardId: 'main',
    id: 'b',
    color: '#AABBCC',
  });
  assert.equal(colored.boards[0].columns[1].color, '#aabbcc');
  assert.deepEqual(colored.cards, s.cards);
  const renamed = act(colored, {
    type: 'column.rename',
    boardId: 'main',
    id: 'b',
    title: 'Renamed',
  });
  assert.equal(renamed.boards[0].columns[1].color, '#aabbcc');
  const reset = act(renamed, {
    type: 'column.color',
    boardId: 'main',
    id: 'b',
    color: null,
  });
  assert.equal(Object.hasOwn(reset.boards[0].columns[1], 'color'), false);
});
test('invalid target or color is rejected atomically', () => {
  const s = fixture(),
    before = structuredClone(s);
  const payloads = [
    { type: 'column.move', id: 'a', beforeId: 'foreign' },
    { type: 'column.move', id: 'missing', beforeId: 'a' },
    { type: 'column.move', id: 'a' },
    ...['red', '#fff', '#11223344', 'url(x)', 2, undefined].map((color) => ({
      type: 'column.color',
      id: 'a',
      color,
    })),
  ];
  for (const p of payloads) {
    assert.throws(() => act(s, { boardId: 'main', ...p }), DomainError);
    assert.deepEqual(s, before);
  }
});
