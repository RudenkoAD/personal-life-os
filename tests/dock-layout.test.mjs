import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PANEL_IDS,
  dockPanel,
  hidePanel,
  initialDock,
  panel,
  resizeSplit,
  restoreDock,
  serializeDock,
  showPanel,
  visiblePanels,
} from '../lib/dock-layout.ts';
const sides = ['left', 'right', 'top', 'bottom'];
function invariant(root, ids = PANEL_IDS) {
  assert.deepEqual([...visiblePanels(root)].sort(), [...ids].sort());
  const seen = new Set();
  const visit = (node) => {
    assert.ok(!seen.has(node.id), `Duplicate node ${node.id}`);
    seen.add(node.id);
    if (node.type === 'split') {
      assert.ok(node.ratio >= 10 && node.ratio <= 90);
      assert.ok(['horizontal', 'vertical'].includes(node.orientation));
      visit(node.first);
      visit(node.second);
    }
  };
  visit(root);
  assert.deepEqual(restoreDock(serializeDock(root)), root);
}

test('every two-step dock permutation preserves each panel exactly once and survives restoration', () => {
  for (const source of PANEL_IDS)
    for (const target of [...PANEL_IDS, null])
      for (const side of sides) {
        const original = initialDock();
        const changed = dockPanel(original, source, target, side);
        invariant(changed);
        if (source === target) assert.equal(changed, original);
        for (const next of PANEL_IDS)
          for (const nextTarget of [...PANEL_IDS, null])
            for (const nextSide of sides)
              invariant(dockPanel(changed, next, nextTarget, nextSide));
        assert.deepEqual(original, initialDock());
      }
});

test('docking relative to a target creates the requested side and orientation', () => {
  for (const side of sides) {
    const root = dockPanel(initialDock(), 'inbox', 'calendar', side);
    const target = root.second;
    assert.equal(target.type, 'split');
    assert.equal(
      target.orientation,
      side === 'left' || side === 'right' ? 'horizontal' : 'vertical',
    );
    assert.deepEqual(
      visiblePanels(target),
      side === 'left' || side === 'top'
        ? ['inbox', 'calendar']
        : ['calendar', 'inbox'],
    );
  }
});

test('screen edge docking wraps the remaining panes and keeps their structure', () => {
  for (const side of sides) {
    const original = initialDock();
    const root = dockPanel(original, 'inbox', null, side);
    const before = side === 'left' || side === 'top';
    assert.deepEqual(before ? root.first : root.second, panel('inbox'));
    assert.deepEqual(before ? root.second : root.first, original.second);
  }
});

test('hiding collapses empty splits, never hides the last pane, and reopening restores it once', () => {
  let root = hidePanel(initialDock(), 'board');
  invariant(root, ['inbox', 'calendar']);
  assert.deepEqual(root.second, panel('calendar'));
  root = hidePanel(root, 'inbox');
  assert.deepEqual(root, panel('calendar'));
  assert.equal(hidePanel(root, 'calendar'), root);
  root = showPanel(root, 'inbox');
  root = showPanel(root, 'board');
  invariant(root);
  assert.equal(showPanel(root, 'board'), root);
});

test('split sizes are independent, bounded, and restored including hidden panes', () => {
  const root = resizeSplit(initialDock(), 'dock-main', 68.24);
  assert.equal(root.ratio, 22);
  assert.equal(root.second.ratio, 68.2);
  const changed = resizeSplit(root, 'dock-root', 31);
  assert.equal(changed.ratio, 31);
  assert.equal(changed.second, root.second);
  assert.equal(resizeSplit(changed, 'dock-root', 31), changed);
  assert.equal(resizeSplit(changed, 'dock-root', Infinity), changed);
  assert.equal(resizeSplit(changed, 'dock-root', -4).ratio, 10);
  assert.equal(resizeSplit(changed, 'dock-root', 999).ratio, 90);
  invariant(changed);
  invariant(hidePanel(changed, 'inbox'), ['board', 'calendar']);
});

test('invalid or stale storage resets safely instead of producing missing or duplicate windows', () => {
  const root = initialDock();
  const invalid = [
    null,
    '',
    '{',
    'null',
    '{}',
    'x'.repeat(6001),
    JSON.stringify({ version: 2, root }),
    serializeDock({ ...root, ratio: 0 }),
    serializeDock({ ...root, ratio: 101 }),
    serializeDock({ ...root, orientation: 'diagonal' }),
    serializeDock({ ...root, second: panel('inbox') }),
    serializeDock(panel('unknown')),
    serializeDock({ ...root, second: null }),
    serializeDock({ ...root, second: { ...root.second, id: root.id } }),
  ];
  for (const raw of invalid) assert.deepEqual(restoreDock(raw), initialDock());
  assert.deepEqual(restoreDock(serializeDock(panel('board'))), panel('board'));
  assert.equal(dockPanel(root, 'board', 'unknown', 'left'), root);
  assert.equal(dockPanel(root, 'unknown', 'board', 'left'), root);
});
