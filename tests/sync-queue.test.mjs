import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncQueue } from '../lib/sync-queue.ts';
import { initialState, applyAction } from '../lib/domain.ts';
import { applyMutation, prepareMutation } from '../lib/mutations.ts';
import { ApiError } from '../lib/api-client.ts';
const conflict = () => new ApiError('conflict', 409, false, true);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await turn();
  }
  assert.fail('condition never became true');
}
function setup(overrides = {}) {
  let server = initialState(),
    stored = [],
    snapshots = [],
    sent = [],
    receipts = new Set();
  const deps = {
    load: async (ids) => ({
      state: structuredClone(server),
      applied: ids.filter((id) => receipts.has(id)),
    }),
    send: async (revision, mutation) => {
      sent.push({ revision, mutation });
      if (receipts.has(mutation.id)) return structuredClone(server);
      if (revision !== server.revision) throw conflict();
      server = applyMutation(server, mutation);
      receipts.add(mutation.id);
      return structuredClone(server);
    },
    remote: async () => {
      throw Error('unexpected remote');
    },
    read: () => structuredClone(stored),
    write: (mutations) => {
      stored = structuredClone(mutations);
    },
    changed: (snapshot) => snapshots.push(snapshot),
    remoteError: () => {},
    retryDelay: () => 1,
    ...overrides,
  };
  const queue = new SyncQueue(deps);
  return {
    queue,
    deps,
    get server() {
      return server;
    },
    set server(s) {
      server = s;
    },
    get stored() {
      return stored;
    },
    set stored(s) {
      stored = s;
    },
    snapshots,
    sent,
    receipts,
  };
}
test('rapid create/edit/move/schedule renders before response and acknowledgements preserve newer changes', async () => {
  const gate = deferred();
  const h = setup();
  const send = h.deps.send;
  let first = true;
  h.deps.send = async (...args) => {
    if (first) {
      first = false;
      await gate.promise;
    }
    return send(...args);
  };
  await h.queue.start();
  assert.equal(h.queue.enqueue({ type: 'capture', title: 'Instant' }), true);
  const id = h.queue.snapshot().state.cards[0].id;
  h.queue.enqueue({ type: 'update', id, title: 'Edited immediately' });
  h.queue.enqueue({ type: 'move', id, boardId: 'main' });
  h.queue.enqueue({
    type: 'schedule',
    id,
    start: '2026-09-08T10:00:00Z',
    end: '2026-09-08T10:45:00Z',
  });
  assert.equal(h.server.cards.length, 0);
  assert.equal(h.queue.snapshot().state.cards[0].title, 'Edited immediately');
  assert.equal(h.queue.snapshot().state.cards[0].placement, 'calendar');
  assert.equal(h.stored.length, 4);
  gate.resolve();
  await until(() => h.queue.snapshot().status === 'saved');
  assert.equal(h.server.cards.length, 1);
  assert.equal(h.server.cards[0].id, id);
  assert.equal(h.server.cards[0].end, '2026-09-08T10:45:00.000Z');
  assert.deepEqual(
    h.sent.map((x) => x.revision),
    [0, 1, 2, 3],
  );
  assert.deepEqual(h.stored, []);
  const afterEdit = h.snapshots.filter(
    (s) => s.count > 0 && s.state?.cards[0]?.title === 'Edited immediately',
  );
  assert.ok(afterEdit.length >= 4);
  h.queue.stop();
});
test('ack of an older edit never resets a later visible edit', async () => {
  const one = deferred(),
    two = deferred();
  const h = setup();
  h.server = applyAction(h.server, { type: 'capture', title: 'Initial' });
  let n = 0;
  const send = h.deps.send;
  h.deps.send = async (...args) => {
    await (++n === 1 ? one.promise : two.promise);
    return send(...args);
  };
  await h.queue.start();
  const id = h.server.cards[0].id;
  h.queue.enqueue({ type: 'update', id, title: 'First' });
  h.queue.enqueue({ type: 'update', id, title: 'Second' });
  one.resolve();
  await until(() => n === 2);
  assert.equal(h.queue.snapshot().state.cards[0].title, 'Second');
  two.resolve();
  await until(() => h.queue.snapshot().status === 'saved');
  assert.equal(h.server.cards[0].title, 'Second');
  h.queue.stop();
});
test('lost response retries same mutation and never duplicates card or history', async () => {
  const h = setup();
  const send = h.deps.send;
  let first = true;
  h.deps.send = async (...args) => {
    const result = await send(...args);
    if (first) {
      first = false;
      throw TypeError('connection lost');
    }
    return result;
  };
  await h.queue.start();
  h.queue.enqueue({ type: 'capture', title: 'Only once' });
  await until(() => h.queue.snapshot().status === 'saved');
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[0].mutation.id, h.sent[1].mutation.id);
  assert.equal(h.server.cards.length, 1);
  assert.equal(h.server.history.length, 1);
  h.queue.stop();
});
test('reload restores pending actions and drops already committed receipts before projection', async () => {
  const h = setup(),
    m = prepareMutation(h.server, { type: 'capture', title: 'Reload' }),
    projected = applyMutation(h.server, m);
  const edit = prepareMutation(projected, {
    type: 'update',
    id: projected.cards[0].id,
    title: 'Restored edit',
  });
  h.stored = [m, edit];
  h.server = projected;
  h.receipts.add(m.id);
  await h.queue.start();
  await until(() => h.queue.snapshot().status === 'saved');
  assert.equal(h.server.cards.length, 1);
  assert.equal(h.server.cards[0].title, 'Restored edit');
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].mutation.id, edit.id);
  h.queue.stop();
});
test('CAS rebase keeps unrelated changes and explicit toggles keep the user intent', async () => {
  const h = setup();
  h.server = applyAction(h.server, {
    type: 'create',
    title: 'Sequence',
    cardType: 'sequence',
  });
  const id = h.server.cards[0].id;
  h.server = applyAction(h.server, { type: 'step.add', id, title: 'Step' });
  const stepId = h.server.cards[0].steps[0].id;
  await h.queue.start();
  h.server = applyAction(h.server, { type: 'step.toggle', id, stepId });
  h.server = applyAction(h.server, { type: 'capture', title: 'Other window' });
  h.queue.enqueue({ type: 'step.toggle', id, stepId });
  await until(() => h.queue.snapshot().status === 'saved');
  assert.equal(h.server.cards.find((c) => c.id === id).steps[0].done, true);
  assert.ok(h.server.cards.some((c) => c.title === 'Other window'));
  h.queue.stop();
});
test('permanent rejection retains outbox and dependent changes until explicit discard', async () => {
  const h = setup();
  h.server = applyAction(h.server, { type: 'capture', title: 'Keep' });
  await h.queue.start();
  const id = h.server.cards[0].id;
  const send = h.deps.send;
  let reject = true;
  h.deps.send = async (...args) => {
    if (reject) throw new ApiError('rejected', 400, false, true);
    return send(...args);
  };
  h.queue.enqueue({ type: 'update', id, title: 'Rejected draft' });
  h.queue.enqueue({ type: 'complete', id, done: true });
  await until(() => h.queue.snapshot().status === 'blocked');
  assert.equal(h.stored.length, 2);
  assert.equal(h.queue.snapshot().canDiscard, true);
  assert.equal(h.queue.snapshot().state.cards[0].title, 'Rejected draft');
  reject = false;
  h.queue.discardRejected();
  await until(() => h.queue.snapshot().status === 'saved');
  assert.equal(h.server.cards[0].title, 'Keep');
  assert.equal(h.server.cards[0].done, true);
  h.queue.stop();
});
test('unknown HTML failures cannot discard a possibly committed mutation', async () => {
  const h = setup({
    send: async () => {
      throw new ApiError('HTML gateway', 403);
    },
  });
  await h.queue.start();
  h.queue.enqueue({ type: 'capture', title: 'Unsure' });
  await until(() => h.queue.snapshot().status === 'blocked');
  assert.equal(h.queue.snapshot().canDiscard, false);
  h.queue.discardRejected();
  assert.equal(h.stored.length, 1);
  h.queue.stop();
});
test('slow external calendar request does not block local changes or overwrite their projection', async () => {
  const gate = deferred(),
    h = setup();
  h.deps.remote = async () => {
    await gate.promise;
    h.server = {
      ...h.server,
      revision: h.server.revision + 1,
      sources: [
        {
          id: 'external',
          title: 'Calendar',
          kind: 'file',
          color: '#112233',
          tags: [],
          enabled: true,
          lastSynced: new Date().toISOString(),
        },
      ],
    };
    return structuredClone(h.server);
  };
  await h.queue.start();
  const importing = h.queue.remote('/api/calendars', { ics: 'private source' });
  h.queue.enqueue({ type: 'capture', title: 'While importing' });
  assert.equal(h.queue.snapshot().state.cards[0].title, 'While importing');
  assert.equal(h.stored.length, 1);
  assert.equal(JSON.stringify(h.stored).includes('private source'), false);
  gate.resolve();
  assert.equal(await importing, true);
  await until(() => h.queue.snapshot().status === 'saved');
  assert.equal(h.server.sources.length, 1);
  assert.equal(h.server.cards.length, 1);
  h.queue.stop();
});
test('project board and step IDs remain identical across client/server replay', () => {
  let state = initialState();
  for (const action of [
    { type: 'create', title: 'Project', cardType: 'project' },
    { type: 'demo' },
  ]) {
    if (action.type === 'demo') state = initialState();
    const m = prepareMutation(state, action),
      a = applyMutation(state, m),
      b = applyMutation(state, structuredClone(m));
    assert.deepEqual(a, b);
  }
});
test('discarding a rejected creation names and removes dependent drafts, preserving independent work', async () => {
  const h = setup();
  let reject = true;
  const send = h.deps.send;
  h.deps.send = async (...args) => {
    if (reject) throw new ApiError('rejected', 400, false, true);
    return send(...args);
  };
  await h.queue.start();
  h.queue.enqueue({ type: 'create', title: 'Parent', cardType: 'project' });
  const board = h.queue.snapshot().state.cards[0].childBoardId;
  h.queue.enqueue({ type: 'create', title: 'Child', boardId: board });
  const child = h.queue.snapshot().state.cards[0].id;
  h.queue.enqueue({ type: 'complete', id: child, done: true });
  h.queue.enqueue({ type: 'capture', title: 'Independent' });
  await until(() => h.queue.snapshot().status === 'blocked');
  assert.equal(h.queue.snapshot().discardCount, 3);
  reject = false;
  h.queue.discardRejected();
  await until(() => h.queue.snapshot().status === 'saved');
  assert.deepEqual(
    h.server.cards.map((c) => c.title),
    ['Independent'],
  );
  h.queue.stop();
});
test('review completion carries notes atomically with its history entry', () => {
  let state = initialState();
  const review = state.reviews[0];
  for (const prompt of review.prompts)
    state = applyAction(state, {
      type: 'review.prompt',
      id: review.id,
      promptId: prompt.id,
    });
  const m = prepareMutation(state, {
    type: 'review.finish',
    id: review.id,
    notes: 'Unsaved notes',
    intervalDays: 7,
  });
  const next = applyMutation(state, m);
  assert.equal(next.reviews[0].history[0].notes, 'Unsaved notes');
  assert.equal(next.reviews[0].intervalDays, 7);
  assert.equal(next.reviews[0].notes, '');
});
