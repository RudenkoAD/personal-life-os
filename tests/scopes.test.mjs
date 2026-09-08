import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, applyAction } from '../lib/domain.ts';
test('scope edits preserve identity and deletion unlinks all consumers without deleting tasks or events', () => {
  let s = initialState();
  s = applyAction(s, {
    type: 'capture',
    title: 'Keep task',
    tags: ['life', 'work'],
  });
  s = applyAction(s, {
    type: 'recurrence.create',
    title: 'Keep template',
    tags: ['life'],
    intervalMinutes: 1440,
    firstAt: '2030-01-01T10:00:00Z',
  });
  s.sources.push({
    id: 'source',
    title: 'Calendar',
    tags: ['life'],
    enabled: true,
    kind: 'file',
    color: '#123456',
    lastSynced: new Date().toISOString(),
  });
  s.events.push({
    id: 'event',
    sourceId: 'source',
    uid: 'uid',
    title: 'Keep event',
    tags: ['life'],
    start: '2030-01-01T10:00:00Z',
    end: '2030-01-01T11:00:00Z',
    allDay: false,
    location: '',
  });
  const cardId = s.cards[0].id;
  s = applyAction(s, {
    type: 'tag.update',
    id: 'life',
    title: 'Дом',
    color: '#334455',
  });
  assert.deepEqual(
    s.tags.find((t) => t.id === 'life'),
    { id: 'life', title: 'Дом', color: '#334455' },
  );
  assert.deepEqual(s.cards[0].tags, ['life', 'work']);
  assert.throws(() =>
    applyAction(s, { type: 'tag.update', id: 'life', title: 'работа' }),
  );
  assert.throws(() =>
    applyAction(s, { type: 'tag.update', id: 'life', color: 'invalid' }),
  );
  s = applyAction(s, { type: 'tag.delete', id: 'life' });
  assert.equal(s.cards[0].id, cardId);
  assert.deepEqual(s.cards[0].tags, ['work']);
  assert.equal(s.events.length, 1);
  assert.deepEqual(s.events[0].tags, []);
  assert.deepEqual(s.sources[0].tags, []);
  assert.deepEqual(s.recurrences[0].tags, []);
});
test('all default scopes may be replaced, and examples still load without resurrecting them', () => {
  let s = initialState();
  for (const tag of s.tags)
    s = applyAction(s, { type: 'tag.delete', id: tag.id });
  assert.equal(s.tags.length, 0);
  s = applyAction(s, {
    type: 'tag.create',
    title: 'Моя сфера',
    color: '#abcdef',
  });
  s = applyAction(s, { type: 'demo' });
  assert.equal(s.tags.length, 1);
  assert.ok(s.cards.length);
  assert.ok(s.cards.every((c) => c.tags.length === 0));
});
