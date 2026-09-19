'use client';

import { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import type { Action, Review, Step } from '@/lib/domain';
import {
  buildReviewTree,
  reviewProgress,
  reviewPromptState,
  type ReviewTreeNode,
} from '@/lib/review-tree';

type Props = {
  review: Review;
  pending: boolean;
  act: (action: Action, success?: string) => Promise<boolean>;
  capturePrompt: (title: string, path?: string[]) => void;
};

function flatten(nodes: ReviewTreeNode[], out: ReviewTreeNode[] = []) {
  for (const node of nodes) {
    out.push(node);
    flatten(node.children, out);
  }
  return out;
}

function parentOf(prompts: Step[], id: string) {
  return (
    (
      prompts.find((p) => p.id === id) as
        | (Step & { parentId?: string | null })
        | undefined
    )?.parentId ?? null
  );
}

function promptPath(prompts: Step[], id: string) {
  const path: string[] = [];
  let current: string | null = id;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const prompt = prompts.find((item) => item.id === current);
    if (!prompt) break;
    path.unshift(prompt.title);
    current = parentOf(prompts, current);
  }
  return path;
}

export function ReviewPromptTree({
  review,
  pending,
  act,
  capturePrompt,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [addDraft, setAddDraft] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const tree = useMemo(() => buildReviewTree(review.prompts), [review.prompts]);
  const flat = useMemo(() => flatten(tree), [tree]);
  const progress = reviewProgress(review.prompts);
  const visible = (
    node: ReviewTreeNode,
    ancestorsOpen = true,
  ): React.ReactNode => {
    if (!ancestorsOpen) return null;
    const p = node.prompt;
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(p.id);
    const state = reviewPromptState(review.prompts, p.id);
    const parent = parentOf(review.prompts, p.id);
    const siblings = parent
      ? (flat.find((x) => x.prompt.id === parent)?.children ?? [])
      : tree;
    const siblingIndex = siblings.findIndex((x) => x.prompt.id === p.id);
    const previousSibling =
      siblingIndex > 0 ? siblings[siblingIndex - 1] : undefined;
    const grandParent = parent ? parentOf(review.prompts, parent) : null;
    const grandSiblings = grandParent
      ? (flat.find((x) => x.prompt.id === grandParent)?.children ?? [])
      : tree;
    const parentIndex = parent
      ? grandSiblings.findIndex((x) => x.prompt.id === parent)
      : -1;
    const uncle = parentIndex >= 0 ? grandSiblings[parentIndex + 1] : undefined;
    const path = promptPath(review.prompts, p.id);
    return (
      <div className="review-tree-node" key={p.id}>
        <div
          className="review-tree-row"
          style={{ '--depth': String(path.length - 1) } as React.CSSProperties}
        >
          <button
            className="review-tree-chevron"
            aria-label={
              isCollapsed ? `Раскрыть: ${p.title}` : `Свернуть: ${p.title}`
            }
            aria-expanded={hasChildren ? !isCollapsed : undefined}
            onClick={() =>
              setCollapsed((old) => {
                const next = new Set(old);
                if (isCollapsed) next.delete(p.id);
                else next.add(p.id);
                return next;
              })
            }
            disabled={!hasChildren}
          >
            {hasChildren ? (
              isCollapsed ? (
                <ChevronRight size={15} />
              ) : (
                <ChevronDown size={15} />
              )
            ) : (
              <span />
            )}
          </button>
          <Checkbox
            className="review-tree-check"
            checked={state === true}
            indeterminate={state === 'indeterminate'}
            data-state={state}
            aria-label={`Готово: ${p.title}`}
            disabled={pending}
            onCheckedChange={(value) =>
              void act(
                {
                  type: 'review.prompt',
                  id: review.id,
                  promptId: p.id,
                  done: value === true,
                },
                'Пункт обновлён',
              )
            }
          />
          {editing === p.id ? (
            <form
              className="review-tree-edit"
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim())
                  void act(
                    {
                      type: 'review.prompt',
                      id: review.id,
                      promptId: p.id,
                      title: draft.trim(),
                    },
                    'Пункт изменён',
                  ).then((ok) => ok && setEditing(null));
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label={`Название: ${p.title}`}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setEditing(null);
                  }
                }}
              />
              <button className="icon-btn" aria-label="Сохранить название">
                <Check size={15} />
              </button>
              <button
                type="button"
                className="quiet-button"
                onClick={() => setEditing(null)}
              >
                Отмена
              </button>
            </form>
          ) : (
            <button
              className={`review-tree-title ${state === true ? 'strike' : ''}`}
              onClick={() =>
                setCollapsed((old) => {
                  const next = new Set(old);
                  if (hasChildren) {
                    if (isCollapsed) next.delete(p.id);
                    else next.add(p.id);
                  }
                  return next;
                })
              }
            >
              {p.title}
            </button>
          )}
          {hasChildren && (
            <span className="review-tree-count">{node.children.length}</span>
          )}
          <div className="review-tree-actions">
            <button
              className="icon-btn"
              aria-label={`Добавить подпункт к ${p.title}`}
              title="Добавить подпункт"
              onClick={() => {
                setAdding(p.id);
                setAddDraft('');
              }}
            >
              <Plus size={15} />
            </button>
            <details className="review-tree-more">
              <summary aria-label={`Действия для ${p.title}`}>Действия</summary>
              <div className="review-tree-menu">
                <button
                  onClick={() => {
                    setEditing(p.id);
                    setDraft(p.title);
                  }}
                >
                  {' '}
                  <Pencil size={14} /> Изменить
                </button>
                {siblingIndex > 0 && (
                  <button
                    onClick={() =>
                      void act(
                        {
                          type: 'review.prompt.move',
                          id: review.id,
                          promptId: p.id,
                          parentId: parent,
                          beforeId: siblings[siblingIndex - 1].prompt.id,
                        },
                        'Пункт перемещён',
                      )
                    }
                  >
                    <ChevronDown className="rotate-up" size={14} /> Выше
                  </button>
                )}
                {siblingIndex >= 0 && siblingIndex < siblings.length - 1 && (
                  <button
                    onClick={() =>
                      void act(
                        {
                          type: 'review.prompt.move',
                          id: review.id,
                          promptId: p.id,
                          parentId: parent,
                          beforeId:
                            siblings[siblingIndex + 2]?.prompt.id ?? null,
                        },
                        'Пункт перемещён',
                      )
                    }
                  >
                    <ChevronDown size={14} /> Ниже
                  </button>
                )}
                {previousSibling && (
                  <button
                    onClick={() =>
                      void act(
                        {
                          type: 'review.prompt.move',
                          id: review.id,
                          promptId: p.id,
                          parentId: previousSibling.prompt.id,
                          beforeId: null,
                        },
                        'Пункт вложен',
                      )
                    }
                  >
                    <CornerDownRight size={14} /> Вложить
                  </button>
                )}
                {parent && (
                  <button
                    onClick={() =>
                      void act(
                        {
                          type: 'review.prompt.move',
                          id: review.id,
                          promptId: p.id,
                          parentId: grandParent,
                          beforeId: uncle?.prompt.id ?? null,
                        },
                        'Пункт перемещён',
                      )
                    }
                  >
                    <CornerDownRight className="rotate-outdent" size={14} />{' '}
                    Уровень выше
                  </button>
                )}
                <button onClick={() => capturePrompt(p.title, path)}>
                  <Plus size={14} /> Создать дело
                </button>
                <button className="danger" onClick={() => setDeleteId(p.id)}>
                  <Trash2 size={14} /> Удалить ветку
                </button>
              </div>
            </details>
          </div>
        </div>
        {adding === p.id && (
          <form
            className="review-tree-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (addDraft.trim())
                void act(
                  {
                    type: 'review.prompt',
                    id: review.id,
                    title: addDraft.trim(),
                    parentId: p.id,
                  },
                  'Подпункт добавлен',
                ).then(
                  (ok) =>
                    ok &&
                    (setAdding(null),
                    setCollapsed((old) => {
                      const next = new Set(old);
                      next.delete(p.id);
                      return next;
                    })),
                );
            }}
          >
            <input
              value={addDraft}
              onChange={(e) => setAddDraft(e.target.value)}
              placeholder="Название подпункта"
              aria-label={`Новый подпункт к ${p.title}`}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setAdding(null);
                }
              }}
            />
            <button className="quiet-button">Добавить</button>
            <button
              type="button"
              className="quiet-button"
              onClick={() => setAdding(null)}
            >
              Отмена
            </button>
          </form>
        )}
        {!isCollapsed && node.children.map((child) => visible(child, true))}
      </div>
    );
  };
  return (
    <div
      className="review-prompt-tree"
      aria-label={`Пункты обзора «${review.title}»`}
    >
      <div className="review-tree-progress">
        <Progress
          value={progress.total ? (progress.done / progress.total) * 100 : 0}
        />
        <span>
          {progress.done} из {progress.total} пунктов
        </span>
        <div className="review-tree-expand">
          <button
            className="text-button"
            onClick={() => setCollapsed(new Set())}
          >
            Раскрыть всё
          </button>
          <button
            className="text-button"
            onClick={() =>
              setCollapsed(
                new Set(
                  flat.filter((n) => n.children.length).map((n) => n.prompt.id),
                ),
              )
            }
          >
            Свернуть ветви
          </button>
        </div>
      </div>
      <div className="review-tree-list">
        {tree.map((node) => visible(node))}
      </div>
      <button
        className="text-button review-tree-add-root"
        onClick={() => {
          setAdding('');
          setAddDraft('');
        }}
      >
        <Plus size={15} /> Добавить пункт
      </button>
      {adding === '' && (
        <form
          className="review-tree-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (addDraft.trim())
              void act(
                {
                  type: 'review.prompt',
                  id: review.id,
                  title: addDraft.trim(),
                },
                'Пункт добавлен',
              ).then((ok) => ok && setAdding(null));
          }}
        >
          <input
            value={addDraft}
            onChange={(e) => setAddDraft(e.target.value)}
            placeholder="Название пункта"
            aria-label="Новый пункт обзора"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setAdding(null);
              }
            }}
          />
          <button className="quiet-button">Добавить</button>
          <button
            type="button"
            className="quiet-button"
            onClick={() => setAdding(null)}
          >
            Отмена
          </button>
        </form>
      )}
      {deleteId && (
        <div
          className="review-tree-confirm"
          role="alertdialog"
          aria-label={`Подтвердить удаление ветки «${review.prompts.find((p) => p.id === deleteId)?.title ?? ''}»`}
        >
          <span>Удалить ветку целиком?</span>
          <button className="quiet-button" onClick={() => setDeleteId(null)}>
            Оставить
          </button>
          <button
            className="danger-button"
            onClick={() =>
              void act(
                {
                  type: 'review.prompt.delete',
                  id: review.id,
                  promptId: deleteId,
                },
                'Ветка удалена',
              ).then((ok) => ok && setDeleteId(null))
            }
          >
            Удалить
          </button>
        </div>
      )}
    </div>
  );
}
