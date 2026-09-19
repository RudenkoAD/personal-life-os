'use client';

import { useMemo, useState } from 'react';
import { Bell, Plus, Save, Trash2 } from 'lucide-react';
import type { Action, LifeState } from '@/lib/domain';
import {
  effectiveReminderMinutes,
  reminderKey,
  type ReminderTarget,
} from '@/lib/reminders';
import type { EventTaskRule } from '@/lib/event-tasks';

type Props = {
  state: LifeState;
  target: ReminderTarget;
  act: (action: Action) => Promise<boolean>;
  readOnly?: boolean;
};
const formatMinutes = (value: number) =>
  value === 0
    ? 'В момент события'
    : value % 1440 === 0
      ? `${value / 1440} дн.`
      : value % 60 === 0
        ? `${value / 60} ч`
        : `${value} мин`;
function parseMinutes(value: string) {
  const tokens = value.split(',').map((x) => x.trim());
  if (!value.trim())
    return { minutes: [] as number[], error: 'Укажите хотя бы один интервал' };
  if (tokens.length > 8)
    return {
      minutes: [] as number[],
      error: 'Можно указать максимум 8 интервалов',
    };
  const minutes = tokens.map(Number);
  if (
    minutes.some(
      (x, i) => !tokens[i] || !Number.isInteger(x) || x < 0 || x > 525600,
    )
  )
    return {
      minutes: [] as number[],
      error: 'Интервалы: целые минуты от 0 до 525600',
    };
  return { minutes: [...new Set(minutes)].sort((a, b) => b - a), error: '' };
}
const taskKey = (target: ReminderTarget) =>
  target.kind === 'occurrence'
    ? `occurrence:${target.id}:${target.occurrenceDate}`
    : `${target.kind}:${target.id}`;
const unitFactors = { min: 1, hour: 60, day: 1440, week: 10080 } as const;
type TaskUnit = keyof typeof unitFactors;
function taskDisplay(minutes: number) {
  for (const unit of ['week', 'day', 'hour', 'min'] as TaskUnit[])
    if (minutes % unitFactors[unit] === 0)
      return { amount: String(minutes / unitFactors[unit]), unit };
  return { amount: String(minutes), unit: 'min' as TaskUnit };
}

export function EventAutomationEditor({
  state,
  target,
  act,
  readOnly = false,
}: Props) {
  const settings = state.reminderSettings ?? {
    defaultMinutes: [],
    byTag: {},
    overrides: {},
  };
  const key = reminderKey(target);
  const explicit = Object.hasOwn(settings.overrides, key);
  const [reminders, setReminders] = useState(() =>
    explicit
      ? settings.overrides[key].join(', ')
      : effectiveReminderMinutes(state, target).join(', '),
  );
  const [reminderMode, setReminderMode] = useState<
    'inherit' | 'off' | 'custom'
  >(() =>
    explicit ? (settings.overrides[key].length ? 'custom' : 'off') : 'inherit',
  );
  const [rules, setRules] = useState<EventTaskRule[]>(() => {
    const exact = state.eventTaskRules?.[taskKey(target)];
    return (
      exact ??
      (target.kind === 'occurrence'
        ? (state.eventTaskRules?.[`series:${target.id}`] ?? [])
        : [])
    );
  });
  const [taskAmounts, setTaskAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      rules.map((rule) => [rule.id, taskDisplay(rule.minutesBefore).amount]),
    ),
  );
  const [taskUnits, setTaskUnits] = useState<Record<string, TaskUnit>>(() =>
    Object.fromEntries(
      rules.map((rule) => [rule.id, taskDisplay(rule.minutesBefore).unit]),
    ),
  );
  const [expanded, setExpanded] = useState<'reminders' | 'tasks' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reminderError, setReminderError] = useState('');
  const effective = useMemo(
    () => effectiveReminderMinutes(state, target),
    [state, target],
  );
  const saveReminders = async () => {
    const minutes =
      reminderMode === 'inherit'
        ? null
        : reminderMode === 'off'
          ? []
          : parseMinutes(reminders).minutes;
    if (reminderMode === 'custom') {
      const parsed = parseMinutes(reminders);
      if (parsed.error || !parsed.minutes.length) {
        setReminderError(parsed.error || 'Укажите интервал');
        return;
      }
    }
    setBusy(true);
    setError('');
    try {
      if (await act({ type: 'reminders.set', target, minutes }))
        setExpanded(null);
      else setError('Не удалось сохранить напоминания');
    } finally {
      setBusy(false);
    }
  };
  const saveTasks = async () => {
    const converted = rules.map((rule) => {
      const amount = Number(taskAmounts[rule.id] ?? '');
      const unit = taskUnits[rule.id] ?? 'min';
      return {
        rule,
        raw: taskAmounts[rule.id] ?? '',
        amount,
        minutesBefore: amount * unitFactors[unit],
      };
    });
    if (
      rules.some(
        (rule) =>
          !rule.title.trim() ||
          rule.title.length > 200 ||
          rule.notes.length > 8000,
      ) ||
      converted.some(
        ({ raw, amount, minutesBefore }) =>
          !raw.trim() ||
          !Number.isInteger(amount) ||
          amount < 0 ||
          !Number.isInteger(minutesBefore) ||
          minutesBefore > 525600,
      )
    ) {
      setError('Заполните название и срок каждой задачи');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (
        await act({
          type: 'event.tasks.set',
          target,
          rules: converted.map(({ rule, minutesBefore }) => ({
            id: rule.id,
            title: rule.title,
            notes: rule.notes,
            minutesBefore,
          })),
        })
      )
        setExpanded(null);
      else setError('Не удалось сохранить задачи');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="detail-section event-automation">
      <div className="automation-actions">
        <button
          className="quiet-button"
          type="button"
          onClick={() =>
            setExpanded(expanded === 'reminders' ? null : 'reminders')
          }
        >
          <Bell size={15} /> Напоминания
        </button>
        <button
          className="quiet-button"
          type="button"
          onClick={() => setExpanded(expanded === 'tasks' ? null : 'tasks')}
        >
          Задачи до события
        </button>
      </div>
      {expanded === 'reminders' && (
        <div className="automation-panel">
          <p className="muted">
            {effective.length
              ? `Сейчас: ${effective.map(formatMinutes).join(', ')}`
              : 'Напоминания выключены'}
          </p>
          {readOnly && (
            <p className="muted">
              Настройки сохраняются в этом приложении; внешний календарь не
              изменяется.
            </p>
          )}
          <>
            <div className="automation-choice">
              <label>
                <input
                  type="radio"
                  checked={reminderMode === 'inherit'}
                  onChange={() => setReminderMode('inherit')}
                />{' '}
                По умолчанию
              </label>
              <label>
                <input
                  type="radio"
                  checked={reminderMode === 'off'}
                  onChange={() => setReminderMode('off')}
                />{' '}
                Выключены
              </label>
              <label>
                <input
                  type="radio"
                  checked={reminderMode === 'custom'}
                  onChange={() => setReminderMode('custom')}
                />{' '}
                Свои
              </label>
            </div>
            {reminderMode === 'custom' && (
              <label>
                Минуты до события
                <input
                  value={reminders}
                  onChange={(e) => {
                    setReminders(e.target.value);
                    setReminderError('');
                  }}
                  placeholder="10080, 1440, 0"
                />
              </label>
            )}
            <button
              className="primary"
              type="button"
              onClick={() => void saveReminders()}
              disabled={busy}
            >
              <Save size={15} /> Сохранить
            </button>
          </>
        </div>
      )}
      {expanded === 'tasks' && (
        <div className="automation-panel">
          {rules.map((rule, index) => (
            <div className="automation-rule" key={rule.id}>
              <input
                aria-label="Название задачи"
                maxLength={200}
                value={rule.title}
                onChange={(e) =>
                  setRules((all) =>
                    all.map((r, i) =>
                      i === index ? { ...r, title: e.target.value } : r,
                    ),
                  )
                }
                placeholder="Что подготовить"
              />
              <input
                aria-label="Заметки задачи"
                maxLength={8000}
                value={rule.notes}
                onChange={(e) =>
                  setRules((all) =>
                    all.map((r, i) =>
                      i === index ? { ...r, notes: e.target.value } : r,
                    ),
                  )
                }
                placeholder="Заметки"
              />
              <label className="automation-deadline">
                Срок
                <input
                  aria-label="Количество до события"
                  type="number"
                  min={0}
                  value={taskAmounts[rule.id] ?? ''}
                  onChange={(e) =>
                    setTaskAmounts((all) => ({
                      ...all,
                      [rule.id]: e.target.value,
                    }))
                  }
                />
                <select
                  aria-label="Единица срока"
                  value={taskUnits[rule.id] ?? 'min'}
                  onChange={(e) =>
                    setTaskUnits((all) => ({
                      ...all,
                      [rule.id]: e.target.value as TaskUnit,
                    }))
                  }
                >
                  <option value="min">минут</option>
                  <option value="hour">часов</option>
                  <option value="day">дней</option>
                  <option value="week">недель</option>
                </select>
              </label>
              <button
                className="icon-btn"
                type="button"
                aria-label="Удалить задачу"
                onClick={() =>
                  setRules((all) => all.filter((_, i) => i !== index))
                }
              >
                <Trash2 size={14} />
              </button>
              {reminderError && (
                <p className="event-error" role="alert">
                  {reminderError}
                </p>
              )}
            </div>
          ))}
          <>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                const id = crypto.randomUUID();
                setRules((all) => [
                  ...all,
                  {
                    id,
                    title: '',
                    notes: '',
                    minutesBefore: 1440,
                    createdAt: new Date().toISOString(),
                  },
                ]);
                setTaskAmounts((all) => ({ ...all, [id]: '1' }));
                setTaskUnits((all) => ({ ...all, [id]: 'day' }));
              }}
              disabled={busy || rules.length >= 8}
            >
              <Plus size={15} /> Добавить задачу
            </button>
            <button
              className="primary"
              type="button"
              onClick={() => void saveTasks()}
              disabled={busy}
            >
              <Save size={15} /> Сохранить
            </button>
          </>
        </div>
      )}
      {error && (
        <p className="event-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function ReminderDefaultsSettings({
  state,
  act,
}: {
  state: LifeState;
  act: (action: Action) => Promise<boolean>;
}) {
  const settings = state.reminderSettings ?? {
    defaultMinutes: [],
    byTag: {},
    overrides: {},
  };
  const [global, setGlobal] = useState(settings.defaultMinutes.join(', '));
  const [byTag, setByTag] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      state.tags.map((tag) => [
        tag.id,
        (settings.byTag[tag.id] ?? []).join(', '),
      ]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = async (scopeId?: string) => {
    const raw = scopeId ? (byTag[scopeId] ?? '') : global;
    const parsed = raw.trim()
      ? parseMinutes(raw)
      : { minutes: [] as number[], error: '' };
    if (parsed.error) {
      setErrors((all) => ({ ...all, [scopeId ?? 'global']: parsed.error }));
      return;
    }
    const value = scopeId && !raw.trim() ? null : parsed.minutes;
    if (
      await act({
        type: 'reminders.defaults',
        ...(scopeId ? { scopeId } : {}),
        minutes: value,
      })
    )
      setErrors((all) => ({ ...all, [scopeId ?? 'global']: '' }));
  };
  return (
    <section className="settings-card">
      <div className="section-heading">
        <Bell size={19} />
        <h2>Напоминания</h2>
      </div>
      <p className="muted">
        Минуты до события, через запятую. Максимум 8 значений, от 0 до 525600.
      </p>
      <div className="preference-row">
        <label htmlFor="reminder-defaults">По умолчанию</label>
        <input
          id="reminder-defaults"
          value={global}
          onChange={(e) => setGlobal(e.target.value)}
          placeholder="Например, 1440, 60"
        />
        <button
          className="text-button"
          type="button"
          onClick={() => void save()}
        >
          Сохранить
        </button>
        {errors.global && (
          <p className="event-error" role="alert">
            {errors.global}
          </p>
        )}
      </div>
      {state.tags.map((tag) => (
        <div className="preference-row" key={tag.id}>
          <label htmlFor={`reminder-${tag.id}`}>{tag.title}</label>
          <input
            id={`reminder-${tag.id}`}
            value={byTag[tag.id] ?? ''}
            onChange={(e) =>
              setByTag((all) => ({ ...all, [tag.id]: e.target.value }))
            }
            placeholder="По умолчанию"
          />
          <button
            className="text-button"
            type="button"
            onClick={() => void save(tag.id)}
          >
            Сохранить
          </button>
          {errors[tag.id] && (
            <p className="event-error" role="alert">
              {errors[tag.id]}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}
