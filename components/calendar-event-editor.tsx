'use client';
import { useId, useState, type SubmitEvent } from 'react';
import { Save, Trash2, Undo2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { type Action, type LifeState } from '@/lib/domain';
import {
  dateAdd,
  validateEventFields,
  validateRepeat,
  type EventFields,
  type EventRepeat,
} from '@/lib/calendar-events';
import { occurrenceFields } from '@/lib/calendar-event-actions';
import {
  toEventDraft as toDraft,
  eventDraftFields as values,
  rebaseEventDraft,
  eventLocalDate,
  type EventDraft as Draft,
} from '@/lib/calendar-event-draft';
import './calendar-events.css';
import { EventAutomationEditor } from '@/components/event-automation-editor';
import { EventLinks } from '@/components/linked-text';

export type EventEditorTarget = {
  seriesId?: string;
  occurrenceDate?: string;
  date: string;
  time?: string;
  durationMinutes?: number;
  allDay?: boolean;
  recurring?: boolean;
};
type Props = {
  state: LifeState;
  target: EventEditorTarget;
  act: (a: Action) => Promise<boolean>;
  close: () => void;
};
const timeAt = (iso: string) =>
  new Date(Date.parse(iso) + 10800000).toISOString().slice(11, 16);
const instant = (day: string, time: string) => `${day}T${time}:00+03:00`;
const weekdays = [
  { value: 1, label: 'Пн' },
  { value: 2, label: 'Вт' },
  { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' },
  { value: 6, label: 'Сб' },
  { value: 0, label: 'Вс' },
];
function Choice({
  id,
  value,
  onChange,
  label,
  options,
  disabled = false,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(value) => value && onChange(value)}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={label}>
        <SelectValue>
          {options.find((o) => o.value === value)?.label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function repeatValue(draft: Draft): EventRepeat {
  const { until: _until, count: _count, ...repeat } = draft.repeat;
  return {
    ...repeat,
    ...(draft.ending === 'until'
      ? { until: draft.repeat.until ?? draft.startDate }
      : {}),
    ...(draft.ending === 'count' ? { count: draft.repeat.count ?? 10 } : {}),
  };
}
function monthDays(date: string) {
  return new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0),
  ).getUTCDate();
}
export function CalendarEventEditor({ state, target, act, close }: Props) {
  const formId = useId();
  const series = state.calendarSeries?.find((s) => s.id === target.seriesId);
  const existingBirthday = series?.birthday;
  const [eventType, setEventType] = useState<'event' | 'birthday'>(
    existingBirthday ? 'birthday' : 'event',
  );
  const [birthdayName, setBirthdayName] = useState(
    existingBirthday?.name ?? '',
  );
  const isBirthday = eventType === 'birthday';
  const isOccurrence = Boolean(
    series &&
    !existingBirthday &&
    target.occurrenceDate &&
    series.repeat.frequency !== 'none',
  );
  const [editScope, setEditScope] = useState<'occurrence' | 'series'>(
    isOccurrence ? 'occurrence' : 'series',
  );
  const baseFields = (scope: 'occurrence' | 'series'): EventFields =>
    series
      ? scope === 'occurrence' && target.occurrenceDate
        ? occurrenceFields(series, target.occurrenceDate)
        : series
      : {
          title: '',
          notes: '',
          location: '',
          tags: [],
          startDate: target.date,
          startTime: target.time ?? '09:00',
          durationMinutes: target.allDay ? 1440 : (target.durationMinutes ?? 60),
          allDay: target.allDay ?? false,
        };
  const initialFields = existingBirthday
    ? {
        ...baseFields('series'),
        title: `День рождения ${existingBirthday.name}`,
        allDay: true,
        startTime: '00:00',
        durationMinutes: 1440,
      }
    : !series && eventType === 'birthday'
      ? {
          ...baseFields('series'),
          title: 'День рождения',
          allDay: true,
          startTime: '00:00',
          durationMinutes: 1440,
        }
      : baseFields(isOccurrence ? 'occurrence' : 'series');
  const [original, setOriginal] = useState(() =>
    toDraft(
      initialFields,
      existingBirthday
        ? { frequency: 'yearly', interval: 1 }
        : (series?.repeat ?? {
            frequency: target.recurring ? 'weekly' : 'none',
            interval: 1,
            weekdays: [new Date(`${target.date}T12:00:00Z`).getUTCDay()],
          }),
    ),
  );
  const [draft, setDraft] = useState(original);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const setRepeat = (patch: Partial<EventRepeat>) =>
    setDraft((d) => ({ ...d, repeat: { ...d.repeat, ...patch } }));
  const switchScope = (scope: 'occurrence' | 'series') => {
    try {
      const fields = baseFields(scope),
        repeat = series!.repeat;
      const next = rebaseEventDraft(draft, original, fields, repeat);
      setOriginal(toDraft(fields, repeat));
      setDraft(next);
      setEditScope(scope);
      setError('');
    } catch (error) {
      setError((error as Error).message);
    }
  };
  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    try {
      if (target.seriesId && !series) throw new Error('Событие уже удалено');
      const fields = validateEventFields(
        values(draft),
        state.tags.map((t) => t.id),
      );
      const before = values(original);
      const patch = Object.fromEntries(
        Object.entries(fields).filter(
          ([key, value]) =>
            JSON.stringify(value) !==
            JSON.stringify(before[key as keyof EventFields]),
        ),
      );
      let action: Action;
      if (series && editScope === 'occurrence')
        action = {
          type: 'event.override',
          id: series.id,
          occurrenceDate: target.occurrenceDate,
          patch,
        };
      else {
        const repeat = validateRepeat(
          isBirthday
            ? { frequency: 'yearly', interval: 1 }
            : repeatValue(draft),
          fields.startDate,
        );
        const birthday = isBirthday ? { name: birthdayName.trim() } : undefined;
        if (
          isBirthday &&
          (!birthday || !birthday.name || birthday.name.length > 180)
        )
          throw new Error('Имя: от 1 до 180 символов');
        action = series
          ? {
              type: 'event.update',
              id: series.id,
              ...patch,
              ...(birthday ? { birthday } : {}),
              ...(JSON.stringify(repeat) !== JSON.stringify(series.repeat)
                ? { repeat }
                : {}),
            }
          : {
              type: 'event.create',
              ...fields,
              repeat,
              ...(birthday ? { birthday } : {}),
            };
      }
      setSaving(true);
      if (await act(action)) close();
      else setError('Не удалось сохранить. Проверьте поля.');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!series) return;
    setSaving(true);
    const action: Action =
      editScope === 'occurrence'
        ? {
            type: 'event.override',
            id: series.id,
            occurrenceDate: target.occurrenceDate,
            cancelled: true,
          }
        : { type: 'event.delete', id: series.id };
    if (await act(action)) close();
    else setError('Не удалось удалить событие.');
    setSaving(false);
    setDeleting(false);
  };
  const repeatDisabled =
    isBirthday || Boolean(series && editScope === 'occurrence');
  return (
    <>
      <Sheet open onOpenChange={(open) => !open && close()}>
        <SheetContent className="event-editor-sheet">
          <SheetHeader>
            <SheetTitle>
              {series
                ? isBirthday
                  ? 'День рождения'
                  : 'Событие'
                : 'Новое событие'}
            </SheetTitle>
            <SheetDescription>
              {series && editScope === 'occurrence'
                ? 'Один повтор · МСК'
                : 'Календарь · МСК'}
            </SheetDescription>
          </SheetHeader>
          <form
            id={formId}
            className="event-editor-form"
            onSubmit={(event) => void submit(event)}
          >
            {isOccurrence && (
              <label className="event-field" htmlFor={formId + '-scope'}>
                Изменить
                <Choice
                  id={formId + '-scope'}
                  value={editScope}
                  onChange={(value) => switchScope(value as typeof editScope)}
                  label="Область изменения"
                  options={[
                    { value: 'occurrence', label: 'Только этот повтор' },
                    { value: 'series', label: 'Всю серию' },
                  ]}
                />
              </label>
            )}
            {!series && (
              <label className="event-field" htmlFor={formId + '-type'}>
                Тип
                <Choice
                  id={formId + '-type'}
                  value={eventType}
                  onChange={(value) => {
                    const next = value as 'event' | 'birthday';
                    setEventType(next);
                    if (next === 'birthday')
                      setDraft((d) => ({
                        ...d,
                        title: `День рождения ${birthdayName.trim()}`.trim(),
                        allDay: true,
                        startTime: '00:00',
                        durationMinutes: 1440,
                        endDate: d.startDate,
                        endTime: '00:00',
                        repeat: { frequency: 'yearly', interval: 1 },
                        ending: 'never',
                      }));
                  }}
                  label="Тип события"
                  options={[
                    { value: 'event', label: 'Событие' },
                    { value: 'birthday', label: 'День рождения' },
                  ]}
                />
              </label>
            )}
            {isBirthday ? (
              <label
                className="event-field"
                htmlFor={formId + '-birthday-name'}
              >
                Имя
                <Input
                  id={formId + '-birthday-name'}
                  required
                  maxLength={180}
                  value={birthdayName}
                  onChange={(e) => {
                    const name = e.target.value;
                    setBirthdayName(name);
                    set('title', `День рождения ${name.trim()}`.trim());
                  }}
                  placeholder="Имя человека"
                />
              </label>
            ) : (
              <label className="event-field" htmlFor={formId + '-title'}>
                Название
                <Input
                  id={formId + '-title'}
                  required
                  maxLength={200}
                  value={draft.title}
                  onChange={(e) => set('title', e.target.value)}
                  placeholder="Собрание…"
                />
              </label>
            )}
            {!isBirthday && (
              <label className="event-check" htmlFor={formId + '-all-day'}>
                <Checkbox
                  id={formId + '-all-day'}
                  checked={draft.allDay}
                  onCheckedChange={(checked) =>
                    setDraft((d) => ({
                      ...d,
                      allDay: checked === true,
                      startTime: checked ? '00:00' : '09:00',
                      endTime: checked ? '00:00' : '10:00',
                    }))
                  }
                />
                Весь день
              </label>
            )}
            <div className="event-date-row">
              <label className="event-field" htmlFor={formId + '-start-date'}>
                {isBirthday ? 'Дата' : 'Начало'}
                <Input
                  id={formId + '-start-date'}
                  type="date"
                  required
                  min="1900-01-01"
                  max="2199-12-31"
                  value={draft.startDate}
                  onChange={(e) => {
                    const date = e.target.value;
                    if (!date || !draft.endDate) {
                      set('startDate', date);
                      return;
                    }
                    const shift =
                      (Date.parse(date + 'T00:00:00Z') -
                        Date.parse(draft.startDate + 'T00:00:00Z')) /
                      86400000;
                    setDraft((d) => ({
                      ...d,
                      startDate: date,
                      endDate: Number.isFinite(shift)
                        ? dateAdd(d.endDate, shift)
                        : date,
                    }));
                  }}
                />
              </label>
              {!draft.allDay && !isBirthday && (
                <label className="event-field" htmlFor={formId + '-start-time'}>
                  Время
                  <Input
                    id={formId + '-start-time'}
                    type="time"
                    required
                    step={60}
                    value={draft.startTime}
                    onChange={(e) => {
                      const time = e.target.value;
                      const shift =
                        Date.parse(instant(draft.startDate, time)) -
                        Date.parse(instant(draft.startDate, draft.startTime));
                      const end =
                        Date.parse(instant(draft.endDate, draft.endTime)) +
                        shift;
                      setDraft((d) =>
                        Number.isFinite(end)
                          ? {
                              ...d,
                              startTime: time,
                              endDate: eventLocalDate(end),
                              endTime: timeAt(new Date(end).toISOString()),
                            }
                          : { ...d, startTime: time },
                      );
                    }}
                  />
                </label>
              )}
            </div>
            {!isBirthday && (
              <div className="event-date-row">
                <label className="event-field" htmlFor={formId + '-end-date'}>
                  Окончание
                  <Input
                    id={formId + '-end-date'}
                    type="date"
                    required
                    min={draft.startDate}
                    max="2199-12-31"
                    value={draft.endDate}
                    onChange={(e) => set('endDate', e.target.value)}
                  />
                </label>
                {!draft.allDay && !isBirthday && (
                  <label className="event-field" htmlFor={formId + '-end-time'}>
                    Время
                    <Input
                      id={formId + '-end-time'}
                      type="time"
                      required
                      step={60}
                      value={draft.endTime}
                      onChange={(e) => set('endTime', e.target.value)}
                    />
                  </label>
                )}
              </div>
            )}
            {!isBirthday && (
              <label className="event-field" htmlFor={formId + '-repeat'}>
                Повтор
                <Choice
                  id={formId + '-repeat'}
                  disabled={repeatDisabled}
                  value={draft.repeat.frequency}
                  onChange={(frequency) =>
                    setRepeat({
                      frequency: frequency as EventRepeat['frequency'],
                      weekdays: draft.repeat.weekdays ?? [
                        new Date(draft.startDate + 'T12:00:00Z').getUTCDay(),
                      ],
                    })
                  }
                  label="Повтор события"
                  options={[
                    { value: 'none', label: 'Не повторяется' },
                    { value: 'daily', label: 'Каждый день' },
                    { value: 'weekly', label: 'Каждую неделю' },
                    { value: 'monthly', label: 'Каждый месяц' },
                    { value: 'yearly', label: 'Каждый год' },
                  ]}
                />
              </label>
            )}
            {draft.repeat.frequency !== 'none' && !repeatDisabled && (
              <fieldset className="event-repeat-settings">
                <legend className="sr-only">Настройка повтора</legend>
                <label className="event-interval">
                  Каждые
                  <Input
                    aria-label="Интервал повторения"
                    type="number"
                    min={1}
                    max={366}
                    required
                    value={draft.repeat.interval}
                    onChange={(e) =>
                      setRepeat({ interval: Number(e.target.value) })
                    }
                  />
                  <span>
                    {
                      {
                        daily: 'дней',
                        weekly: 'недель',
                        monthly: 'месяцев',
                        yearly: 'лет',
                      }[
                        draft.repeat.frequency as
                          | 'daily'
                          | 'weekly'
                          | 'monthly'
                          | 'yearly'
                      ]
                    }
                  </span>
                </label>
                {draft.repeat.frequency === 'weekly' && (
                  <div className="event-weekdays">
                    {weekdays.map(({ value, label }) => (
                      <label key={value} className="event-weekday">
                        <Checkbox
                          aria-label={label}
                          checked={
                            draft.repeat.weekdays?.includes(value) ?? false
                          }
                          onCheckedChange={(checked) =>
                            setRepeat({
                              weekdays: checked
                                ? [...(draft.repeat.weekdays ?? []), value]
                                : (draft.repeat.weekdays ?? []).filter(
                                    (day) => day !== value,
                                  ),
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                )}
                {draft.repeat.frequency === 'monthly' && (
                  <Choice
                    value={draft.repeat.monthlyMode ?? 'date'}
                    onChange={(monthlyMode) =>
                      setRepeat({
                        monthlyMode: monthlyMode as 'date' | 'weekday',
                      })
                    }
                    label="Правило месяца"
                    options={[
                      { value: 'date', label: 'В это число месяца' },
                      { value: 'weekday', label: 'В этот день недели месяца' },
                    ]}
                  />
                )}
                <label className="event-field" htmlFor={formId + '-ending'}>
                  Закончить
                  <Choice
                    id={formId + '-ending'}
                    value={draft.ending}
                    onChange={(value) =>
                      set('ending', value as Draft['ending'])
                    }
                    label="Окончание повторов"
                    options={[
                      { value: 'never', label: 'Никогда' },
                      { value: 'until', label: 'До даты включительно' },
                      {
                        value: 'count',
                        label: 'После заданного числа событий',
                      },
                    ]}
                  />
                </label>
                {draft.ending === 'until' && (
                  <Input
                    aria-label="Последняя дата повторов"
                    type="date"
                    required
                    min={draft.startDate}
                    max="2199-12-31"
                    value={draft.repeat.until ?? draft.startDate}
                    onChange={(e) => setRepeat({ until: e.target.value })}
                  />
                )}
                {draft.ending === 'count' && (
                  <Input
                    aria-label="Число событий"
                    type="number"
                    min={1}
                    max={10000}
                    required
                    value={draft.repeat.count ?? 10}
                    onChange={(e) =>
                      setRepeat({ count: Number(e.target.value) })
                    }
                  />
                )}
                {((draft.repeat.frequency === 'monthly' &&
                  draft.repeat.monthlyMode !== 'weekday' &&
                  Number(draft.startDate.slice(-2)) > 28) ||
                  (draft.repeat.frequency === 'yearly' &&
                    draft.startDate.endsWith('02-29'))) && (
                  <p className="event-help">
                    Если даты нет в месяце, повтор пропускается.
                  </p>
                )}
              </fieldset>
            )}
            {draft.repeat.frequency === 'monthly' &&
              draft.repeat.monthlyMode === 'weekday' &&
              !repeatDisabled && (
                <p className="event-help">
                  {Number(draft.startDate.slice(-2)) + 7 >
                  monthDays(draft.startDate)
                    ? 'В последний такой день недели месяца.'
                    : `В ${Math.ceil(Number(draft.startDate.slice(-2)) / 7)}-й такой день недели месяца.`}
                </p>
              )}
            {repeatDisabled && (
              <p className="event-help">
                Чтобы изменить расписание, выберите всю серию.
              </p>
            )}
            {series && (
              <EventAutomationEditor
                state={state}
                target={
                  editScope === 'occurrence' && target.occurrenceDate
                    ? {
                        kind: 'occurrence',
                        id: series.id,
                        occurrenceDate: target.occurrenceDate,
                      }
                    : { kind: 'series', id: series.id }
                }
                act={act}
              />
            )}
            <label className="event-field" htmlFor={formId + '-location'}>
              Место
              <Input
                id={formId + '-location'}
                maxLength={300}
                value={draft.location}
                onChange={(e) => set('location', e.target.value)}
              />
            </label>
            <label className="event-field" htmlFor={formId + '-notes'}>
              Заметки
              <Textarea
                id={formId + '-notes'}
                rows={3}
                maxLength={8000}
                value={draft.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </label>
            <EventLinks value={draft.notes} />
            <div className="event-scopes">
              {state.tags.map((tag) => (
                <label className="event-check" key={tag.id}>
                  <Checkbox
                    checked={draft.tags.includes(tag.id)}
                    onCheckedChange={(checked) =>
                      set(
                        'tags',
                        checked
                          ? [...draft.tags, tag.id]
                          : draft.tags.filter((id) => id !== tag.id),
                      )
                    }
                  />
                  <i style={{ background: tag.color }} />
                  {tag.title}
                </label>
              ))}
            </div>
            {series &&
              editScope === 'series' &&
              Object.keys(series.exceptions).length > 0 && (
                <details className="event-exceptions">
                  <summary>
                    Изменённые повторы · {Object.keys(series.exceptions).length}
                  </summary>
                  {Object.entries(series.exceptions)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([date, exception]) => (
                      <div key={date}>
                        <span>
                          {date} ·{' '}
                          {exception.cancelled
                            ? 'удалён'
                            : exception.startDate &&
                                exception.startDate !== date
                              ? `→ ${exception.startDate}`
                              : 'изменён'}
                        </span>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Восстановить повтор ${date}`}
                          onClick={async () => {
                            if (
                              await act({
                                type: 'event.restore',
                                id: series.id,
                                occurrenceDate: date,
                              })
                            )
                              setError('');
                          }}
                        >
                          <Undo2 size={14} />
                        </button>
                      </div>
                    ))}
                </details>
              )}
            {error && (
              <p role="alert" className="event-error">
                {error}
              </p>
            )}
            {series &&
              target.occurrenceDate &&
              series.exceptions[target.occurrenceDate] &&
              editScope === 'occurrence' && (
                <button
                  className="text-button"
                  type="button"
                  onClick={async () => {
                    if (
                      await act({
                        type: 'event.restore',
                        id: series.id,
                        occurrenceDate: target.occurrenceDate,
                      })
                    )
                      close();
                  }}
                >
                  <Undo2 size={14} />
                  Вернуть по расписанию
                </button>
              )}
          </form>
          <div className="event-editor-actions">
            {series && (
              <button
                className="icon-btn danger"
                type="button"
                aria-label={
                  editScope === 'occurrence'
                    ? 'Удалить этот повтор'
                    : 'Удалить серию'
                }
                disabled={saving}
                onClick={() => setDeleting(true)}
              >
                <Trash2 size={17} />
              </button>
            )}
            <button className="quiet-button" type="button" onClick={close}>
              Отмена
            </button>
            <button
              className="primary"
              form={formId}
              type="submit"
              disabled={saving}
            >
              <Save size={15} />
              Сохранить
            </button>
          </div>
        </SheetContent>
      </Sheet>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {editScope === 'occurrence'
                ? 'Удалить этот повтор?'
                : 'Удалить всю серию?'}
            </AlertDialogTitle>
            <AlertDialogDescription>{series?.title}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
