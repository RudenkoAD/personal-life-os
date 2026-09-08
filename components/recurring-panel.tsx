'use client';

import { useId, useMemo, useState, type SubmitEvent } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { createPortal } from 'react-dom';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  CircleHelp,
  Inbox,
  Pencil,
  Plus,
  Repeat2,
  Save,
  Trash2,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  dateKey,
  type RecurringRule,
  type Action,
  type LifeState,
} from '@/lib/domain';

type Unit = 'minutes' | 'hours' | 'days' | 'weeks';
type Draft = {
  title: string;
  notes: string;
  tags: string[];
  amount: string;
  unit: Unit;
  firstAt: string;
};

export interface RecurringPanelProps {
  state: LifeState;
  act: (action: Action) => Promise<boolean>;
  openCard: (id: string) => void;
  error?: string;
  toolbarTarget?: HTMLElement | null;
}

const units: Array<{ value: Unit; label: string; minutes: number }> = [
  { value: 'minutes', label: 'минут', minutes: 1 },
  { value: 'hours', label: 'часов', minutes: 60 },
  { value: 'days', label: 'дней', minutes: 1440 },
  { value: 'weeks', label: 'недель', minutes: 10080 },
];
const toLocalInput = (iso: string) =>
  `${dateKey(new Date(iso))}T${new Intl.DateTimeFormat('ru', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))}`;
const nowDraft = (): Draft => ({
  title: '',
  notes: '',
  tags: [],
  amount: '1',
  unit: 'days',
  firstAt: toLocalInput(new Date().toISOString()),
});
const formatAt = (iso: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
const localToIso = (value: string) =>
  new Date(`${value}:00+03:00`).toISOString();
const ruleUnit = (minutes: number) => {
  const found = [...units]
    .reverse()
    .find((unit) => minutes % unit.minutes === 0);
  return found
    ? { unit: found.value, amount: String(minutes / found.minutes) }
    : {
        unit: 'hours' as Unit,
        amount: String(Math.max(1, Math.round(minutes / 60))),
      };
};

export function RecurringPanel({
  state,
  act,
  openCard,
  error,
  toolbarTarget,
}: RecurringPanelProps) {
  const formId = useId();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(nowDraft);
  const [originalDraft, setOriginalDraft] = useState<Draft>(nowDraft);
  const [originalFirstAt, setOriginalFirstAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const rules = useMemo(
    () =>
      [...state.recurrences].sort((a, b) =>
        (a.nextAt ?? a.firstAt).localeCompare(b.nextAt ?? b.firstAt),
      ),
    [state.recurrences],
  );
  const editing = editingId
    ? state.recurrences.find((r) => r.id === editingId)
    : null;
  const beginEdit = (rule: RecurringRule) => {
    const cadence = ruleUnit(rule.intervalMinutes);
    setEditorOpen(true);
    setEditingId(rule.id);
    setOriginalFirstAt(toLocalInput(rule.nextAt ?? rule.firstAt));
    const nextDraft = {
      title: rule.title,
      notes: rule.notes,
      tags: [...rule.tags],
      amount: cadence.amount,
      unit: cadence.unit,
      firstAt: toLocalInput(rule.nextAt ?? rule.firstAt),
    };
    setDraft(nextDraft);
    setOriginalDraft(nextDraft);
  };
  const beginCreate = () => {
    setEditorOpen(true);
    setEditingId(null);
    setDraft(nowDraft());
  };
  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(draft.amount);
    const unit = units.find((item) => item.value === draft.unit) ?? units[1];
    if (
      !draft.title.trim() ||
      !Number.isInteger(amount) ||
      amount < 1 ||
      !draft.firstAt
    )
      return;
    const action: Action = {
      type: editingId ? 'recurrence.update' : 'recurrence.create',
      ...(editingId ? { id: editingId } : {}),
      title: draft.title.trim(),
      notes: draft.notes.trim(),
      tags: draft.tags.filter((id) => state.tags.some((t) => t.id === id)),
      intervalMinutes: amount * unit.minutes,
    };
    if (editingId) {
      if (draft.title === originalDraft.title) delete action.title;
      if (draft.notes === originalDraft.notes) delete action.notes;
      if (JSON.stringify(draft.tags) === JSON.stringify(originalDraft.tags))
        delete action.tags;
      if (
        draft.amount === originalDraft.amount &&
        draft.unit === originalDraft.unit
      )
        delete action.intervalMinutes;
    }
    // Updating firstAt is intentionally conditional: changing a template/cadence must not reset nextAt.
    if (!editingId || draft.firstAt !== originalFirstAt)
      action.firstAt = localToIso(draft.firstAt);
    setSaving(true);
    if (await act(action)) {
      setEditorOpen(false);
      setEditingId(null);
      setDraft(nowDraft());
    }
    setSaving(false);
  };
  const remove = async () => {
    if (!removeId) return;
    setSaving(true);
    if (await act({ type: 'recurrence.delete', id: removeId })) {
      setRemoveId(null);
      if (editingId === removeId) {
        setEditorOpen(false);
        setEditingId(null);
        setDraft(nowDraft());
      }
    }
    setSaving(false);
  };

  const toolbar = (
    <div className="recurring-toolbar">
      <span className="view-count">{rules.length}</span>
      <Popover>
        <PopoverTrigger
          className="icon-btn"
          aria-label="Как работают повторения"
          title="Как работают повторения"
        >
          <CircleHelp size={17} />
        </PopoverTrigger>
        <PopoverContent className="compact-help-popover">
          <PopoverTitle>Повторения</PopoverTitle>
          <p>
            Таймер ждёт, пока задача в Inbox. Выполнение или перенос запускает
            новый интервал. Сроки проверяются в открытой вкладке; после перерыва
            задача появится при открытии.
          </p>
        </PopoverContent>
      </Popover>
      <button className="primary" onClick={beginCreate}>
        <Plus size={16} />
        Новое повторение
      </button>
    </div>
  );
  return (
    <section className="recurring-panel" aria-label="Рекуррентные дела">
      {toolbarTarget ? createPortal(toolbar, toolbarTarget) : toolbar}
      <div className="recurring-layout">
        <div className="recurring-list" aria-label="Список повторений">
          {rules.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">
                <Repeat2 size={26} />
              </span>
              <h2>Пока нет повторений</h2>
              <button className="quiet-button" onClick={beginCreate}>
                <Plus size={16} />
                Добавить повторение
              </button>
            </div>
          ) : (
            rules.map((rule) => {
              const waiting = rule.waitingCardId
                ? state.cards.find((card) => card.id === rule.waitingCardId)
                : null;
              const paused = Boolean(
                waiting && waiting.placement === 'inbox' && !waiting.done,
              );
              return (
                <article className="recurring-card" key={rule.id}>
                  <div className="recurring-card-main">
                    <span className="recurring-icon">
                      <Repeat2 size={17} />
                    </span>
                    <div>
                      <h2>{rule.title}</h2>
                      {rule.notes && (
                        <p className="recurring-notes-preview">{rule.notes}</p>
                      )}
                      <div className="recurring-meta">
                        <span>
                          каждые{' '}
                          {rule.intervalMinutes % 10080 === 0
                            ? `${rule.intervalMinutes / 10080} нед.`
                            : rule.intervalMinutes % 1440 === 0
                              ? `${rule.intervalMinutes / 1440} дн.`
                              : rule.intervalMinutes % 60 === 0
                                ? `${rule.intervalMinutes / 60} ч.`
                                : `${rule.intervalMinutes} мин.`}
                        </span>
                        {rule.tags.map((tag) => (
                          <span className="tag" key={tag}>
                            {state.tags.find((t) => t.id === tag)?.title}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div
                    className={`recurring-status${paused ? ' is-paused' : ''}`}
                  >
                    {paused && waiting ? (
                      <button
                        className="recurring-waiting"
                        aria-label={`Открыть задачу ${waiting?.title}`}
                        onClick={() => openCard(waiting.id)}
                      >
                        <Inbox size={14} /> В Inbox · пауза
                      </button>
                    ) : rule.nextAt ? (
                      <>
                        <small>Следующее появление</small>
                        <time dateTime={rule.nextAt}>
                          {formatAt(rule.nextAt)}
                        </time>
                      </>
                    ) : null}
                  </div>
                  <div className="recurring-actions">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Изменить ${rule.title}`}
                      onClick={() => beginEdit(rule)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Удалить ${rule.title}`}
                      onClick={() => setRemoveId(rule.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>
      <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
        <SheetContent className="recurring-editor-sheet">
          <SheetHeader>
            <SheetTitle>
              {editingId ? 'Изменить повторение' : 'Новое повторение'}
            </SheetTitle>
            <SheetDescription className="sr-only">
              Задача, интервал и время появления во входящих.
            </SheetDescription>
          </SheetHeader>
          <form className="recurring-form" onSubmit={submit}>
            <label className="form-field" htmlFor={`${formId}-title`}>
              <span className="field-label">Название</span>
              <Input
                id={`${formId}-title`}
                required
                maxLength={200}
                value={draft.title}
                onChange={(event) =>
                  setDraft({ ...draft, title: event.target.value })
                }
                placeholder="Например, разобрать почту"
              />
            </label>
            <label className="form-field" htmlFor={`${formId}-notes`}>
              <span className="field-label">Заметки</span>
              <Textarea
                id={`${formId}-notes`}
                maxLength={8000}
                value={draft.notes}
                onChange={(event) =>
                  setDraft({ ...draft, notes: event.target.value })
                }
                rows={2}
                placeholder="Заметки к задаче"
              />
            </label>
            <fieldset className="recurring-scopes">
              <legend className="field-label">Сферы жизни</legend>
              <div className="tag-choices">
                {state.tags.map((tag) => (
                  <label className="checkbox-label" key={tag.id}>
                    <Checkbox
                      checked={draft.tags.includes(tag.id)}
                      onCheckedChange={(checked) =>
                        setDraft((d) => ({
                          ...d,
                          tags: checked
                            ? [...d.tags, tag.id]
                            : d.tags.filter((id) => id !== tag.id),
                        }))
                      }
                    />
                    <span
                      className="scope-dot"
                      style={{ background: tag.color }}
                    />
                    {tag.title}
                  </label>
                ))}
              </div>
              {!state.tags.length && (
                <p className="muted">Добавить сферы можно в настройках.</p>
              )}
            </fieldset>
            <div className="recurring-cadence">
              <label className="form-field" htmlFor={`${formId}-amount`}>
                <span className="field-label">Каждые</span>
                <Input
                  id={`${formId}-amount`}
                  type="number"
                  min={1}
                  max={Math.floor(
                    (365 * 1440) /
                      (units.find((u) => u.value === draft.unit)?.minutes ?? 1),
                  )}
                  step={1}
                  required
                  value={draft.amount}
                  onChange={(event) =>
                    setDraft({ ...draft, amount: event.target.value })
                  }
                />
              </label>
              <label className="form-field">
                <span className="field-label">Единица</span>
                <select
                  className="choice recurring-select"
                  value={draft.unit}
                  onChange={(event) =>
                    setDraft({ ...draft, unit: event.target.value as Unit })
                  }
                >
                  {units.map((unit) => (
                    <option key={unit.value} value={unit.value}>
                      {unit.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="form-field">
              <span className="field-label">
                {editing?.generation
                  ? 'Следующее появление'
                  : 'Первое появление'}{' '}
                · МСК
              </span>
              <Input
                type="datetime-local"
                disabled={!!editing?.waitingCardId}
                required
                value={draft.firstAt}
                onChange={(event) =>
                  setDraft({ ...draft, firstAt: event.target.value })
                }
              />
              <span className="muted">
                {editing?.waitingCardId
                  ? 'На паузе, пока задача в Inbox.'
                  : editing?.generation
                    ? 'Изменение даты задаст следующий срок вручную.'
                    : ''}
              </span>
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="detail-actions recurring-form-actions">
              <Button type="submit" disabled={saving || !draft.title.trim()}>
                <Save />{' '}
                {saving ? 'Сохраняем…' : editing ? 'Сохранить' : 'Добавить'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditorOpen(false)}
              >
                Отмена
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
      <AlertDialog
        open={Boolean(removeId)}
        onOpenChange={(open) => !open && setRemoveId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить повторение?</AlertDialogTitle>
            <AlertDialogDescription>
              Шаблон будет удалён. Все уже созданные задачи останутся на месте.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={() => void remove()}>
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

export default RecurringPanel;
