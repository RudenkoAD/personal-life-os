export interface ReviewPrompt {
  id: string;
  title: string;
  done: boolean;
  parentId?: string | null;
}

export interface ReviewTreeNode {
  prompt: ReviewPrompt;
  children: ReviewTreeNode[];
}

export function validateReviewPrompts(prompts: ReviewPrompt[], maxDepth = 32) {
  if (!Array.isArray(prompts))
    throw new Error('Пункты обзора должны быть списком');
  const ids = new Set<string>();
  for (const prompt of prompts) {
    if (
      !prompt ||
      typeof prompt.id !== 'string' ||
      !prompt.id ||
      ids.has(prompt.id)
    )
      throw new Error('Пункты обзора должны иметь уникальные идентификаторы');
    ids.add(prompt.id);
  }
  for (const prompt of prompts) {
    if (
      prompt.parentId !== undefined &&
      prompt.parentId !== null &&
      (typeof prompt.parentId !== 'string' || !ids.has(prompt.parentId))
    )
      throw new Error('Родительский пункт не найден');
  }
  const byId = new Map(prompts.map((p) => [p.id, p]));
  for (const prompt of prompts) {
    const seen = new Set<string>();
    let current: ReviewPrompt | undefined = prompt;
    let depth = 0;
    while (current?.parentId != null) {
      if (seen.has(current.id)) throw new Error('Цикл в пунктах обзора');
      seen.add(current.id);
      current = byId.get(current.parentId);
      if (++depth > maxDepth)
        throw new Error('Слишком глубокая вложенность пунктов');
    }
  }
  return prompts;
}

export function buildReviewTree(prompts: ReviewPrompt[]): ReviewTreeNode[] {
  validateReviewPrompts(prompts);
  const nodes = new Map(
    prompts.map((prompt) => [
      prompt.id,
      { prompt, children: [] as ReviewTreeNode[] },
    ]),
  );
  const roots: ReviewTreeNode[] = [];
  for (const prompt of prompts) {
    const node = nodes.get(prompt.id)!;
    if (prompt.parentId == null) roots.push(node);
    else nodes.get(prompt.parentId)!.children.push(node);
  }
  return roots;
}

function findNode(
  nodes: ReviewTreeNode[],
  id: string,
): ReviewTreeNode | undefined {
  for (const node of nodes) {
    if (node.prompt.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return undefined;
}

export function reviewProgress(prompts: ReviewPrompt[]) {
  validateReviewPrompts(prompts);
  const leaves = prompts.filter(
    (prompt) => !prompts.some((child) => child.parentId === prompt.id),
  );
  return {
    done: leaves.filter((prompt) => prompt.done).length,
    total: leaves.length,
  };
}

export function reviewPromptState(
  prompts: ReviewPrompt[],
  promptId: string,
): boolean | 'indeterminate' {
  const tree = buildReviewTree(prompts);
  const node = findNode(tree, promptId);
  if (!node) throw new Error('Пункт не найден');
  const leaves: ReviewPrompt[] = [];
  const collect = (item: ReviewTreeNode) =>
    item.children.length
      ? item.children.forEach(collect)
      : leaves.push(item.prompt);
  collect(node);
  const done = leaves.filter((prompt) => prompt.done).length;
  return done === leaves.length ? true : done === 0 ? false : 'indeterminate';
}

export function reviewDescendantIds(
  prompts: ReviewPrompt[],
  promptId: string,
): Set<string> {
  const tree = buildReviewTree(prompts);
  const node = findNode(tree, promptId);
  if (!node) throw new Error('Пункт не найден');
  const ids = new Set<string>();
  const visit = (item: ReviewTreeNode) => {
    ids.add(item.prompt.id);
    item.children.forEach(visit);
  };
  visit(node);
  return ids;
}
