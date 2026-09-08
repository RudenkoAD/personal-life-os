'use client';
import { useState, type SubmitEvent } from 'react';
import { Palette, Plus, Save, Trash2 } from 'lucide-react';
import type { Action, Scope } from '@/lib/domain';
import { useSyncedDraft } from '@/hooks/use-synced-draft';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';

type Act = (action: Action) => Promise<boolean>;
function ScopeEditor({
  tag,
  act,
  remove,
}: {
  tag: Scope;
  act: Act;
  remove: () => void;
}) {
  const [title, setTitle] = useSyncedDraft(tag.title);
  const [color, setColor] = useSyncedDraft(tag.color);
  return (
    <form
      className="scope-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void act({ type: 'tag.update', id: tag.id, title, color });
      }}
    >
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        aria-label={`Цвет сферы ${tag.title}`}
      />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={40}
        required
        aria-label={`Название сферы ${tag.title}`}
      />
      <button
        className="icon-btn scope-save"
        type="submit"
        disabled={!title.trim() || (title === tag.title && color === tag.color)}
        aria-label={`Сохранить сферу ${tag.title}`}
      >
        <Save size={16} />
        <span className="sr-only">Сохранить</span>
      </button>
      <button
        className="icon-btn"
        type="button"
        onClick={remove}
        aria-label={`Удалить сферу ${tag.title}`}
      >
        <Trash2 size={16} />
      </button>
    </form>
  );
}
export function ScopesSettings({ tags, act }: { tags: Scope[]; act: Act }) {
  const [title, setTitle] = useState('');
  const [color, setColor] = useState('#6677dd');
  const [deleting, setDeleting] = useState<Scope | null>(null);
  const add = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (await act({ type: 'tag.create', title, color })) setTitle('');
  };
  return (
    <section className="settings-card" id="life-scopes">
      <div className="section-heading">
        <Palette size={21} />
        <div>
          <h2>Сферы жизни</h2>
        </div>
      </div>
      <div className="scope-editors">
        {tags.map((tag) => (
          <ScopeEditor
            key={tag.id}
            tag={tag}
            act={act}
            remove={() => setDeleting(tag)}
          />
        ))}
      </div>
      {!tags.length && <p className="inline-empty">Нет сфер</p>}
      <form className="scope-editor scope-create" onSubmit={add}>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label="Цвет новой сферы"
        />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={40}
          required
          placeholder="Новая сфера жизни"
          aria-label="Название новой сферы"
        />
        <button
          className="quiet-button"
          disabled={!title.trim() || tags.length >= 100}
        >
          <Plus size={16} />
          Добавить
        </button>
      </form>
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Удалить сферу «{deleting?.title}»?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Её метки исчезнут с задач, календарей и шаблонов повторений. Все
              задачи и события останутся.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) void act({ type: 'tag.delete', id: deleting.id });
                setDeleting(null);
              }}
            >
              Удалить сферу
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
