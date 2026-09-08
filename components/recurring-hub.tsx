'use client';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Plus } from 'lucide-react';
import {
  RecurringPanel,
  type RecurringPanelProps,
} from '@/components/recurring-panel';
import { recurrenceLabel } from '@/lib/calendar-events';
import { dateKey } from '@/lib/domain';
import type { EventEditorTarget } from '@/components/calendar-event-editor';
import './calendar-events.css';

export function RecurringHub({
  openEvent,
  query,
  scope,
  ...props
}: RecurringPanelProps & {
  openEvent: (target: EventEditorTarget) => void;
  query: string;
  scope: string;
}) {
  const [kind, setKind] = useState<'tasks' | 'events'>('tasks');
  const series = (props.state.calendarSeries ?? []).filter(
    (event) =>
      event.repeat.frequency !== 'none' &&
      (scope === 'all' || event.tags.includes(scope)) &&
      event.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const tabs = (
    <fieldset className="recurring-kind-tabs" aria-label="Вид повторений">
      {(['tasks', 'events'] as const).map((value) => (
        <button
          key={value}
          className={value === kind ? 'quiet-button active' : 'quiet-button'}
          aria-pressed={value === kind}
          onClick={() => setKind(value)}
        >
          {value === 'tasks' ? 'Дела' : 'События'}
        </button>
      ))}
    </fieldset>
  );
  const toolbar = (
    <>
      {tabs}
      {kind === 'events' && (
        <>
          <span className="calendar-event-count">{series.length}</span>
          <button
            className="primary"
            onClick={() => openEvent({ date: dateKey(), recurring: true })}
          >
            <Plus size={15} />
            Событие
          </button>
        </>
      )}
    </>
  );
  return (
    <>
      {props.toolbarTarget ? (
        createPortal(toolbar, props.toolbarTarget)
      ) : (
        <div className="recurring-toolbar">{toolbar}</div>
      )}
      {kind === 'tasks' ? (
        <RecurringPanel {...props} />
      ) : (
        <div className="calendar-events-list">
          {series.map((event) => (
            <button
              key={event.id}
              className="calendar-series-row"
              onClick={() =>
                openEvent({ seriesId: event.id, date: event.startDate })
              }
            >
              <CalendarDays size={20} />
              <div>
                <h2>{event.title}</h2>
                <p>
                  {recurrenceLabel(event)}
                  {event.repeat.until
                    ? ` · до ${event.repeat.until}`
                    : event.repeat.count
                      ? ` · ${event.repeat.count} событий`
                      : ''}
                </p>
              </div>
              <small>
                {event.allDay
                  ? 'Весь день'
                  : `${event.startTime} · ${event.durationMinutes} мин`}
              </small>
            </button>
          ))}
          {!series.length && (
            <button
              className="calendar-series-row"
              onClick={() => openEvent({ date: dateKey(), recurring: true })}
            >
              <Plus size={20} />
              <div>
                <h2>Добавить повторяющееся событие</h2>
                <p>Собрание или день рождения</p>
              </div>
            </button>
          )}
        </div>
      )}
    </>
  );
}
