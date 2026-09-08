export const PANEL_IDS = ['inbox', 'board', 'calendar'] as const;
export type DockPanelId = (typeof PANEL_IDS)[number];
export type DockSide = 'left' | 'right' | 'top' | 'bottom';
export type DockNode =
  | { type: 'panel'; id: DockPanelId }
  | {
      type: 'split';
      id: string;
      orientation: 'horizontal' | 'vertical';
      ratio: number;
      first: DockNode;
      second: DockNode;
    };
export const panel = (id: DockPanelId): DockNode => ({ type: 'panel', id });
export function initialDock(): DockNode {
  return {
    type: 'split',
    id: 'dock-root',
    orientation: 'horizontal',
    ratio: 22,
    first: panel('inbox'),
    second: {
      type: 'split',
      id: 'dock-main',
      orientation: 'horizontal',
      ratio: 57,
      first: panel('board'),
      second: panel('calendar'),
    },
  };
}
export function visiblePanels(root: DockNode): DockPanelId[] {
  return root.type === 'panel'
    ? [root.id]
    : [...visiblePanels(root.first), ...visiblePanels(root.second)];
}
export function nodeKey(node: DockNode) {
  return `${node.type}:${node.id}`;
}
function remove(root: DockNode, id: DockPanelId): DockNode | null {
  if (root.type === 'panel') return root.id === id ? null : root;
  const first = remove(root.first, id),
    second = remove(root.second, id);
  if (!first) return second;
  if (!second) return first;
  if (first === root.first && second === root.second) return root;
  return { ...root, first, second };
}
export function hidePanel(root: DockNode, id: DockPanelId): DockNode {
  return remove(root, id) ?? root;
}
function beside(target: DockNode, id: DockPanelId, side: DockSide): DockNode {
  const before = side === 'left' || side === 'top';
  return {
    type: 'split',
    id: crypto.randomUUID(),
    orientation:
      side === 'left' || side === 'right' ? 'horizontal' : 'vertical',
    ratio: 50,
    first: before ? panel(id) : target,
    second: before ? target : panel(id),
  };
}
export function dockPanel(
  root: DockNode,
  id: DockPanelId,
  target: DockPanelId | null,
  side: DockSide,
): DockNode {
  if (
    id === target ||
    !PANEL_IDS.includes(id) ||
    !['left', 'right', 'top', 'bottom'].includes(side)
  )
    return root;
  if (target && !visiblePanels(root).includes(target)) return root;
  const rest = remove(root, id);
  if (!rest) return root;
  if (target === null) return beside(rest, id, side);
  const insert = (node: DockNode): DockNode =>
    node.type === 'panel'
      ? node.id === target
        ? beside(node, id, side)
        : node
      : { ...node, first: insert(node.first), second: insert(node.second) };
  return insert(rest);
}
export function showPanel(root: DockNode, id: DockPanelId): DockNode {
  return visiblePanels(root).includes(id) ? root : beside(root, id, 'right');
}
export function resizeSplit(
  root: DockNode,
  id: string,
  ratio: number,
): DockNode {
  if (!Number.isFinite(ratio)) return root;
  const bounded = Math.max(10, Math.min(90, Math.round(ratio * 10) / 10));
  if (root.type === 'panel') return root;
  if (root.id === id)
    return Math.abs(root.ratio - bounded) < 0.05
      ? root
      : { ...root, ratio: bounded };
  const first = resizeSplit(root.first, id, ratio),
    second = resizeSplit(root.second, id, ratio);
  return first === root.first && second === root.second
    ? root
    : { ...root, first, second };
}
export function serializeDock(root: DockNode) {
  return JSON.stringify({ version: 1, root });
}
export function restoreDock(raw: string | null): DockNode {
  if (!raw || raw.length > 6000) return initialDock();
  try {
    const data = JSON.parse(raw);
    if (data.version !== 1) throw new Error('version');
    const seen = new Set<string>();
    let count = 0;
    const validate = (node: unknown, depth = 0): DockNode => {
      if (!node || typeof node !== 'object' || depth > 3 || ++count > 5)
        throw new Error('node');
      const n = node as Record<string, unknown>;
      if (typeof n.id !== 'string' || n.id.length > 100 || seen.has(n.id))
        throw new Error('id');
      seen.add(n.id);
      if (n.type === 'panel' && PANEL_IDS.includes(n.id as DockPanelId))
        return panel(n.id as DockPanelId);
      if (
        n.type !== 'split' ||
        (n.orientation !== 'horizontal' && n.orientation !== 'vertical') ||
        typeof n.ratio !== 'number' ||
        !Number.isFinite(n.ratio) ||
        n.ratio < 10 ||
        n.ratio > 90
      )
        throw new Error('split');
      return {
        type: 'split',
        id: n.id,
        orientation: n.orientation,
        ratio: n.ratio,
        first: validate(n.first, depth + 1),
        second: validate(n.second, depth + 1),
      };
    };
    return validate(data.root);
  } catch {
    return initialDock();
  }
}
